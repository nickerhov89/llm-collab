import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter, once } from "node:events";
import { createOpenRouterGateway } from "./polza-openrouter-gateway.mjs";

test("serves live agent catalog, deduplicates reads and retains last good catalog", async (t) => {
  let calls = 0,
    fail = false,
    clock = 0;
  const row = (id) => ({
    id,
    name: "Model " + id,
    architecture: { output_modalities: ["text"] },
    supported_parameters: ["tools"],
    context_length: 131072,
  });
  const upstream = http.createServer((req, res) => {
    calls++;
    assert.equal(req.url, "/v1/models");
    assert.equal(
      req.headers.authorization,
      undefined,
      "Catalog must not transmit the operator key",
    );
    res.setHeader("content-type", "application/json");
    res.writeHead(fail ? 503 : 200);
    res.end(
      JSON.stringify({
        data: [
          row("qwen/coder"),
          row("openai/text"),
          row("qwen/coder"),
          row("anthropic/claude:batch"),
          {
            ...row("image/model"),
            architecture: { output_modalities: ["image"] },
          },
          { ...row("plain/model"), supported_parameters: [] },
        ],
      }),
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const gateway = createOpenRouterGateway({
    upstreamBase: "http://127.0.0.1:" + upstream.address().port,
    cacheTtlMs: 10,
    now: () => clock,
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  t.after(() => {
    gateway.closeAllConnections();
    gateway.close();
    upstream.closeAllConnections();
    upstream.close();
  });
  const url = "http://127.0.0.1:" + gateway.address().port + "/v1/models";
  const results = await Promise.all(
    Array.from({ length: 5 }, () => fetch(url).then((r) => r.json())),
  );
  assert(results.every((r) => r.data.length === 3));
  assert.equal(calls, 1);
  assert.deepEqual(
    results[0].data.map((m) => m.id),
    ["openrouter/auto", "openai/text", "qwen/coder"],
  );
  assert.equal(results[0].data[2].max_model_len, 131072);
  fail = true;
  clock = 20;
  const stale = await (await fetch(url)).json();
  assert.equal(stale.data.length, 3);
  const cold = createOpenRouterGateway({
    upstreamBase: "http://127.0.0.1:" + upstream.address().port,
  });
  cold.listen(0, "127.0.0.1");
  await once(cold, "listening");
  t.after(() => {
    cold.closeAllConnections();
    cold.close();
  });
  const unavailable = await fetch(
    "http://127.0.0.1:" + cold.address().port + "/v1/models",
  );
  assert.equal(unavailable.status, 503);
  assert.match(
    (await unavailable.json()).error.message,
    /temporarily unavailable/,
  );
});

test("opt-in Auto pool preserves explicit choices and provider refusals", async (t) => {
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push(Buffer.concat(chunks).toString());
    res.writeHead(403, {
      "content-type": "application/json",
      "x-request-id": "refused-1",
    });
    res.end(
      JSON.stringify({
        error: { code: 403, message: "Provider Terms Of Service restriction" },
      }),
    );
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => upstream.close());
  const start = async (autoAllowedModels) => {
    const gateway = createOpenRouterGateway({
      upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
      autoAllowedModels,
    });
    await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
    t.after(() => gateway.close());
    return `http://127.0.0.1:${gateway.address().port}`;
  };
  const enabled = await start([" qwen/qwen3-coder ", "qwen/qwen3-coder"]);
  const disabled = await start([]);
  const send = async (origin, path, wire) => {
    const response = await fetch(origin + path, {
      method: "POST",
      headers: {
        authorization: "Bearer test",
        "content-type": "application/json",
      },
      body: wire,
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("x-request-id"), "refused-1");
    assert.equal((await response.json()).error.code, 403);
    return received.at(-1);
  };
  const manual = '{ "model": "anthropic/claude-sonnet-4.6", "messages": [] }';
  assert.equal(await send(enabled, "/v1/messages", manual), manual);
  const auto = '{ "model": "openrouter/auto", "messages": [], "stream": true }';
  assert.equal(await send(disabled, "/v1/messages", auto), auto);
  for (const path of [
    "/v1/messages",
    "/v1/responses",
    "/v1/chat/completions",
  ]) {
    const wire = await send(enabled, path, auto);
    assert.deepEqual(JSON.parse(wire), {
      ...JSON.parse(auto),
      plugins: [{ id: "auto-router", allowed_models: ["qwen/qwen3-coder"] }],
    });
  }
  const explicit = JSON.stringify({
    model: "openrouter/auto",
    plugins: [
      { id: "auto-router", allowed_models: ["deepseek/*"], cost_tier: "low" },
    ],
  });
  assert.equal(await send(enabled, "/v1/messages", explicit), explicit);
  const beforeInvalid = received.length;
  const invalid = await fetch(`${enabled}/v1/messages`, {
    method: "POST",
    headers: { authorization: "Bearer test" },
    body: '{"private-prompt":',
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.message, "Invalid inference JSON");
  assert.equal(received.length, beforeInvalid);
});

test("refreshes the account catalog without readers and exposes failures without losing good models", {
  timeout: 3000,
}, async (t) => {
  const events = new EventEmitter();
  let calls = 0;
  let fail = false;
  const upstream = http.createServer((req, res) => {
    assert.equal(req.url, "/v1/models/user");
    assert.equal(req.headers.authorization, "Bearer fixture-catalog-key");
    calls++;
    res.writeHead(fail ? 503 : 200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: [
          {
            id: "fixture/available",
            architecture: {
              input_modalities: ["text"],
              output_modalities: ["text"],
            },
            supported_parameters: ["tools"],
          },
        ],
      }),
    );
    events.emit("read", calls);
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const gateway = createOpenRouterGateway({
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    getCatalogToken: async () => "fixture-catalog-key",
    refreshIntervalMs: 25,
  });
  t.after(async () => {
    await new Promise((resolve) => gateway.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  });
  const firstRead = once(events, "read");
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  await firstRead;
  const secondRead = once(events, "read");
  await secondRead; // No gateway GET or browser open caused either read.
  const origin = `http://127.0.0.1:${gateway.address().port}`;
  const unauth = await fetch(origin + "/catalog/refresh", { method: "POST" });
  assert.equal(unauth.status, 401);
  const refreshed = await fetch(origin + "/catalog/refresh", {
    method: "POST",
    headers: { authorization: "Bearer dummy" },
  });
  const good = await refreshed.json();
  assert.equal(good.catalog.source, "account");
  assert.equal(good.catalog.state, "ready");
  assert.deepEqual(
    good.data.find((m) => m.id === "fixture/available").input_modalities,
    ["text"],
  );
  assert.equal(JSON.stringify(good).includes("fixture-catalog-key"), false);
  fail = true;
  const bad = await fetch(origin + "/catalog/refresh", {
    method: "POST",
    headers: { authorization: "Bearer dummy" },
  });
  assert.equal(bad.status, 503);
  const status = await (await fetch(origin + "/health")).json();
  assert.equal(status.catalog.state, "stale");
  assert.equal(status.catalog.lastError, "Catalog HTTP 503");
  const retained = await (await fetch(origin + "/v1/models")).json();
  assert.deepEqual(retained.data, good.data);
});

test("routes Auto images in history and tool results only through the vision pool", async (t) => {
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const start = async (vision) => {
    const gateway = createOpenRouterGateway({
      upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
      autoAllowedModels: ["fixture/text"],
      autoImageAllowedModels: vision,
    });
    gateway.listen(0, "127.0.0.1");
    await once(gateway, "listening");
    t.after(() => new Promise((resolve) => gateway.close(resolve)));
    return `http://127.0.0.1:${gateway.address().port}`;
  };
  t.after(() => upstream.close());
  const enabled = await start(["fixture/vision"]);
  const disabled = await start([]);
  const send = async (origin, input) =>
    fetch(origin + "/v1/messages", {
      method: "POST",
      headers: { authorization: "Bearer fixture" },
      body: JSON.stringify(input),
    });
  const cases = [
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", data: "fixture" } },
          ],
        },
        { role: "user", content: "Continue" },
      ],
    },
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", content: [{ type: "image", source: {} }] },
          ],
        },
      ],
    },
    {
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "data:fixture" } }],
        },
      ],
    },
    {
      input: [
        {
          role: "user",
          content: [{ type: "input_image", image_url: "data:fixture" }],
        },
      ],
    },
  ];
  for (const content of cases) {
    const input = { model: "openrouter/auto", ...content };
    assert.equal((await send(enabled, input)).status, 200);
    assert.deepEqual(received.at(-1), {
      ...input,
      plugins: [{ id: "auto-router", allowed_models: ["fixture/vision"] }],
    });
  }
  assert.equal(
    (
      await send(enabled, {
        model: "openrouter/auto",
        messages: [{ role: "user", content: "Text only" }],
      })
    ).status,
    200,
  );
  assert.deepEqual(received.at(-1).plugins, [
    { id: "auto-router", allowed_models: ["fixture/text"] },
  ]);
  const manual = { model: "fixture/manual", ...cases[0] };
  assert.equal((await send(enabled, manual)).status, 200);
  assert.deepEqual(received.at(-1), manual);
  const override = {
    model: "openrouter/auto",
    ...cases[0],
    plugins: [{ id: "auto-router", allowed_models: ["custom/*"] }],
  };
  assert.equal((await send(enabled, override)).status, 200);
  assert.deepEqual(received.at(-1), override);
  const count = received.length;
  assert.equal(
    (await send(disabled, { model: "openrouter/auto", ...cases[0] })).status,
    422,
  );
  assert.equal(received.length, count);
});

test("translates native replay records without rewriting live tools, calls or opaque records", async (t) => {
  let received;
  const upstream = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    received = JSON.parse(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const gateway = createOpenRouterGateway({
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  t.after(async () => {
    await new Promise((r) => gateway.close(r));
    await new Promise((r) => upstream.close(r));
  });
  const declarations = {
    type: "additional_tools",
    id: "old-tools",
    role: "developer",
    tools: [
      {
        type: "namespace",
        name: "historical",
        tools: [{ type: "custom", name: "exec" }],
      },
    ],
  };
  const input = {
    model: "qwen/fixture",
    tools: [{ type: "function", name: "current" }],
    input: [
      declarations,
      {
        role: "user",
        content: [
          { type: "reasoning_text", text: "Public historical summary" },
          { type: "input_image", image_url: "data:fixture" },
        ],
      },
      {
        type: "custom_tool_call",
        call_id: "one",
        name: "exec",
        input: "synthetic",
      },
      {
        type: "custom_tool_call_output",
        call_id: "one",
        output: "synthetic result",
      },
      { type: "compaction", encrypted_content: "opaque-fixture" },
      {
        type: "reasoning",
        id: "reasoning-fixture",
        encrypted_content: "opaque-reasoning",
        summary: [{ type: "summary_text", text: "Existing summary" }],
        content: [
          { type: "reasoning_text", text: "Preserved public reasoning" },
        ],
      },
      {
        type: "function_call",
        call_id: "current-call",
        name: "current",
        arguments: "{}",
      },
      { type: "function_call_output", call_id: "current-call", output: "OK" },
    ],
  };
  const response = await fetch(
    `http://127.0.0.1:${gateway.address().port}/v1/responses`,
    {
      method: "POST",
      headers: { authorization: "Bearer fixture" },
      body: JSON.stringify(input),
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(received.tools, input.tools);
  assert.equal(received.input[0].type, "message");
  assert.equal(received.input[0].role, "assistant");
  assert.ok(
    received.input[0].content[0].text.includes(JSON.stringify(declarations)),
  );
  assert.deepEqual(received.input[1].content, [
    { type: "input_text", text: "Public historical summary" },
    input.input[1].content[1],
  ]);
  assert.deepEqual(received.input.slice(2, 4), input.input.slice(2, 4));
  assert.deepEqual(received.input[4], input.input[4]);
  assert.deepEqual(received.input[5], {
    type: "reasoning",
    id: "reasoning-fixture",
    encrypted_content: "opaque-reasoning",
    summary: [
      { type: "summary_text", text: "Existing summary" },
      { type: "summary_text", text: "Preserved public reasoning" },
    ],
  });
  assert.deepEqual(input.input[0], declarations);
  assert.deepEqual(received.input.slice(6, 8), input.input.slice(6, 8));
  assert.equal(received.input.at(-1).role, "developer");
  assert.match(received.input.at(-1).content[0].text, /names.*current/);
  assert.doesNotMatch(
    received.input.at(-1).content[0].text,
    /historical\.exec/,
  );
});

test("upstream stream failure terminates only that response and keeps gateway alive", async (t) => {
  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"type":"response.created"}\n\n');
    setTimeout(() => res.destroy(), 25);
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const gateway = createOpenRouterGateway({
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    gateway.closeAllConnections();
    gateway.close();
    upstream.closeAllConnections();
    upstream.close();
  });
  const base = `http://127.0.0.1:${gateway.address().port}`;
  const response = await fetch(base + "/v1/responses", {
    method: "POST",
    headers: { authorization: "Bearer fixture" },
    body: JSON.stringify({ model: "fixture", input: [] }),
  });
  await assert.rejects(response.text());
  assert.equal((await (await fetch(base + "/health")).json()).ok, true);
});

test("HTTP bridge applies the legacy shell alias only to opted-in Responses history", async (t) => {
  const item = {
    id: "fc_alias",
    call_id: "call_alias",
    type: "function_call",
    name: "exec",
    arguments: '{"cmd":"printf OK"}',
  };
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    received.push(JSON.parse(raw));
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const e of [
      { type: "response.output_item.added", item: { ...item, arguments: "" } },
      { type: "response.output_item.done", item },
      { type: "response.completed", response: { output: [item] } },
    ])
      res.write("data: " + JSON.stringify(e) + "\n\n");
    res.end();
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const gateway = createOpenRouterGateway({
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    defaultMaxOutputTokens: 8192,
  });
  await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
  t.after(() => {
    gateway.closeAllConnections();
    gateway.close();
    upstream.closeAllConnections();
    upstream.close();
  });
  const tools = [
    {
      type: "function",
      name: "exec_command",
      parameters: {
        type: "object",
        properties: { cmd: { type: "string" } },
        required: ["cmd"],
      },
    },
  ];
  for (const legacy of [true, false]) {
    const r = await fetch(
      `http://127.0.0.1:${gateway.address().port}/v1/responses`,
      {
        method: "POST",
        headers: { authorization: "Bearer fixture" },
        body: JSON.stringify({
          model: "fixture",
          ...(legacy ? {} : { max_output_tokens: 777 }),
          tools,
          input: legacy ? [{ type: "additional_tools", tools: [] }] : [],
        }),
      },
    );
    const wire = await r.text();
    const last = JSON.parse(
      wire
        .trim()
        .split("\n")
        .findLast((l) => l.startsWith("data: "))
        .slice(6),
    );
    assert.equal(received.at(-1).max_output_tokens, legacy ? 8192 : 777);
    assert.equal(
      last.response.output[0].name,
      legacy ? "exec_command" : "exec",
    );
  }
});
