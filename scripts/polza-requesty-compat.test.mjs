import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createOpenRouterGateway } from "./polza-openrouter-gateway.mjs";
const rows = [
  "google/gemini-2.5-flash",
  "zai/glm-5.3",
  "alibaba/qwen3.8-max",
].map((id) => ({
  api: "chat",
  id,
  supports_tool_calling: true,
  supports_vision: id.includes("gemini"),
  context_window: 1000000,
  input_price: 0.000001,
  output_price: 0.000002,
}));
async function fixture(t, status = 200) {
  const calls = [];
  const upstream = http.createServer(async (req, res) => {
    if (req.method === "GET") {
      calls.push({ url: req.url, auth: req.headers.authorization });
      res.end(JSON.stringify({ data: rows }));
      return;
    }
    let b = "";
    for await (const c of req) b += c;
    calls.push({ url: req.url, body: JSON.parse(b) });
    const reply = typeof status === "function" ? status(JSON.parse(b)) : status;
    const code = typeof reply === "number" ? reply : reply.status;
    res.writeHead(code, {
      "content-type": code === 200 ? "text/event-stream" : "application/json",
      "retry-after": "60",
    });
    res.end(
      typeof reply === "object" && reply.body
        ? reply.body
        : code === 200
          ? 'data: {"type":"response.completed"}\n\n'
          : JSON.stringify({ error: { message: "quota" } }),
    );
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const gateway = createOpenRouterGateway({
    upstreamKind: "requesty",
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    getCatalogToken: () => "fixture",
    autoAllowedModels: [rows[0].id, rows[1].id],
    autoImageAllowedModels: [rows[0].id],
    limitCooldowns: true,
  });
  await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
  t.after(() => {
    gateway.closeAllConnections();
    gateway.close();
    upstream.closeAllConnections();
    upstream.close();
  });
  const base = `http://127.0.0.1:${gateway.address().port}`;
  return {
    calls,
    base,
    post: (b, endpoint = "/v1/responses") =>
      fetch(base + endpoint, {
        method: "POST",
        headers: { authorization: "Bearer fixture" },
        body: JSON.stringify(b),
      }),
  };
}
test("Requesty authenticated catalog uses /models, preserves pricing/vision and exposes explicit legacy migrations", async (t) => {
  const f = await fixture(t);
  const d = await (await fetch(f.base + "/v1/models")).json();
  assert.equal(f.calls[0].url, "/v1/models");
  assert.equal(f.calls[0].auth, "Bearer fixture");
  assert.equal(d.data[0].name, "Requesty Auto");
  assert(
    d.data
      .find((m) => m.id === "qwen/qwen3-coder")
      .name.includes("qwen3.8-max"),
  );
  assert.equal(
    d.data.find((m) => m.id === rows[0].id).pricing.prompt,
    "0.000001",
  );
});
test("Requesty native same-chat replay preserves context, tool results, live tools and opaque reasoning", async (t) => {
  const f = await fixture(t);
  const input = [
    { role: "user", content: "remember SAME_CHAT_42" },
    {
      type: "function_call",
      name: "read_tool",
      call_id: "call42",
      arguments: "{}",
    },
    { type: "function_call_output", call_id: "call42", output: "OK" },
    { type: "reasoning", encrypted_content: "opaque" },
    { role: "user", content: "continue" },
  ];
  const tools = [
    {
      type: "function",
      name: "read_tool",
      parameters: { type: "object", properties: {} },
    },
  ];
  const r = await f.post({ model: "z-ai/glm-5.3", input, tools, stream: true });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /response.completed/);
  const b = f.calls.at(-1).body;
  assert.equal(b.model, "zai/glm-5.3");
  assert.deepEqual(b.input, input);
  assert.deepEqual(b.tools, tools);
});
test("legacy Auto resolves each call without an OpenRouter plugin and keeps explicit model selections", async (t) => {
  const f = await fixture(t);
  for (const b of [
    { model: "openrouter/auto", input: "simple" },
    { model: "openrouter/auto", input: "deep", reasoning: { effort: "high" } },
    { model: "alibaba/qwen3.8-max", input: "manual" },
  ]) {
    const r = await f.post(b);
    await r.text();
    assert.equal(r.status, 200);
  }
  const a = f.calls.filter((x) => x.body).map((x) => x.body);
  assert.deepEqual(
    a.map((x) => x.model),
    [rows[0].id, rows[1].id, rows[2].id],
  );
  assert(a.every((x) => !x.plugins));
});
test("unknown model ends visibly in the same chat without sending an invented model upstream", async (t) => {
  const f = await fixture(t);
  const r = await f.post({ model: "missing/not-real", input: "private" });
  assert.equal(r.status, 422);
  assert.match((await r.json()).error.message, /same chat/);
  assert.equal(f.calls.filter((x) => x.body).length, 0);
});
test("Requesty quota failure is bounded and names the correct service", async (t) => {
  const f = await fixture(t, 429);
  const r = await f.post({ model: rows[0].id, input: "hello" });
  assert.equal(r.status, 429);
  const e = await r.json();
  assert.match(e.error.message, /Requesty/);
  assert(!e.error.message.includes("OpenRouter"));
  assert.equal(f.calls.filter((x) => x.body).length, 1);
});

test("Requesty Auto keeps images in old tool results on a vision route even with high effort", async (t) => {
  const f = await fixture(t);
  const input = [
    {
      type: "function_call_output",
      call_id: "old",
      output: [
        { type: "input_image", image_url: "data:image/png;base64,fixture" },
      ],
    },
  ];
  const r = await f.post({
    model: "openrouter/auto",
    input,
    reasoning: { effort: "high" },
    stream: true,
  });
  assert.equal(r.status, 200);
  await r.text();
  const b = f.calls.at(-1).body;
  assert.equal(b.model, rows[0].id);
  assert.deepEqual(b.input, input);
});

test("Requesty accepts native compaction and array custom-tool results without losing their stored data", async (t) => {
  const f = await fixture(t);
  const compact = {
    type: "compaction",
    id: "compact-old",
    encrypted_content: "opaque",
    internal_chat_message_metadata_passthrough: { turn: 2 },
  };
  const output = [
    { type: "input_text", text: "first result" },
    { type: "input_text", text: "second result" },
  ];
  const input = [
    { role: "user", content: "Visible pre-compaction context" },
    compact,
    {
      type: "custom_tool_call",
      name: "exec",
      call_id: "old-call",
      input: "historic command",
    },
    { type: "custom_tool_call_output", call_id: "old-call", output },
    { role: "user", content: "Continue same chat" },
  ];
  const snapshot = structuredClone(input);
  const response = await f.post({ model: rows[0].id, input });
  assert.equal(response.status, 200);
  await response.text();
  const actual = f.calls.at(-1).body.input;
  assert.deepEqual(actual[0], input[0]);
  assert.equal(actual[1].type, "message");
  assert(actual[1].content[0].text.endsWith(JSON.stringify(compact)));
  assert.deepEqual(actual[2], input[2]);
  assert.equal(actual[3].call_id, "old-call");
  assert.deepEqual(JSON.parse(actual[3].output), output);
  assert.deepEqual(actual[4], input[4]);
  assert.deepEqual(input, snapshot);
});

test("Auto preserves mixed native Search and agent tools on a compatible configured route", async (t) => {
  const f = await fixture(t);
  const tools = [
    { type: "web_search" },
    {
      type: "function",
      name: "exec_command",
      parameters: { type: "object", properties: {} },
    },
  ];
  const r = await f.post({
    model: "openrouter/auto",
    input: "Reply OK",
    tools,
  });
  assert.equal(r.status, 200);
  await r.text();
  const actual = f.calls.at(-1).body;
  assert.equal(actual.model, "zai/glm-5.3");
  assert.deepEqual(actual.tools, tools);
});

for (const endpoint of [
  "/v1/responses",
  "/v1/messages",
  "/v1/chat/completions",
]) {
  test(`Auto retries a pre-stream quota rejection once on another compatible model: ${endpoint}`, async (t) => {
    const f = await fixture(t, (b) => (b.model === rows[0].id ? 429 : 200));
    const input = [
      { role: "user", content: "synthetic quota context" },
      {
        type: "function_call_output",
        call_id: "already-executed",
        output: "do not execute again",
      },
    ];
    const body = {
      model: "openrouter/auto",
      input,
      stream: true,
      tools: [
        { type: "function", name: "read_only", parameters: { type: "object" } },
      ],
    };
    const r = await f.post(body, endpoint);
    assert.equal(r.status, 200);
    await r.text();
    assert.equal(r.headers.get("x-polza-route-fallback"), "quota");
    assert.equal(r.headers.get("x-polza-route-model"), rows[1].id);
    const attempts = f.calls.filter((c) => c.body);
    assert.deepEqual(
      attempts.map((c) => c.body.model),
      [rows[0].id, rows[1].id],
    );
    assert.deepEqual(
      { ...attempts[0].body, model: rows[1].id },
      attempts[1].body,
    );
    assert.deepEqual(attempts[1].body.input, input);
    const again = await f.post(body, endpoint);
    assert.equal(again.status, 200);
    await again.text();
    assert.deepEqual(
      f.calls.filter((c) => c.body).map((c) => c.body.model),
      [rows[0].id, rows[1].id, rows[1].id],
    );
  });
}
test("Auto stops when both model quotas are exhausted and observes their cooldown", async (t) => {
  const f = await fixture(t, 429);
  const body = { model: "openrouter/auto", input: [], stream: true };
  for (let i = 0; i < 2; i++) {
    const r = await f.post(body);
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("retry-after"), "60");
    await r.text();
  }
  assert.equal(f.calls.filter((c) => c.body).length, 2);
});
test("manual selections and account credit failures do not silently route elsewhere", async (t) => {
  for (const status of [429, 402, 403]) {
    const f = await fixture(t, status);
    const r = await f.post({
      model: status === 429 ? rows[0].id : "openrouter/auto",
      input: [],
      stream: true,
    });
    assert.equal(r.status, status);
    await r.text();
    assert.equal(f.calls.filter((c) => c.body).length, 1);
    if (status === 402) {
      const other = await f.post({ model: rows[1].id, input: [] });
      assert.equal(other.status, 402);
      await other.text();
      assert.equal(f.calls.filter((c) => c.body).length, 1);
    }
  }
});
test("accepted streams are never replayed after a quota error, including tool output", async (t) => {
  const stream =
    'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"once"}}\n\ndata: {"type":"error","error":{"code":"rate_limit_exceeded","message":"429 quota"}}\n\n';
  const f = await fixture(t, () => ({ status: 200, body: stream }));
  const r = await f.post({ model: "openrouter/auto", input: [], stream: true });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), stream);
  assert.equal(f.calls.filter((c) => c.body).length, 1);
});
test("quota fallback preserves vision and mixed-tool capability requirements", async (t) => {
  const vision = await fixture(t, 429);
  const r = await vision.post({
    model: "openrouter/auto",
    input: [
      {
        role: "user",
        content: [
          { type: "input_image", image_url: "data:image/png;base64,fixture" },
        ],
      },
    ],
    stream: true,
  });
  assert.equal(r.status, 429);
  await r.text();
  assert.deepEqual(
    vision.calls.filter((c) => c.body).map((c) => c.body.model),
    [rows[0].id],
  );
  const tools = await fixture(t, 429);
  const mixed = await tools.post({
    model: "openrouter/auto",
    input: [],
    tools: [{ type: "web_search" }, { type: "function", name: "read" }],
    stream: true,
  });
  assert.equal(mixed.status, 429);
  await mixed.text();
  assert.deepEqual(
    tools.calls.filter((c) => c.body).map((c) => c.body.model),
    [rows[1].id],
  );
});
