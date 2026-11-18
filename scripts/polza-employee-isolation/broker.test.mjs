import { spawn } from "node:child_process";
import { once, EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

test("broker admits native-sized JSON while retaining payload, model and budget gates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "employee-broker-"));
  const config = join(directory, "config.json");
  const ledger = join(directory, "ledger.json");
  await writeFile(
    config,
    JSON.stringify({
      model: "allowed-model",
      upstreamKey: "unused-synthetic-key",
      accounts: {
        marker: { token: "synthetic-capability", dailyLimit: 0 },
        bridge: { token: "bridge-capability", dailyLimit: 10 },
        second: { token: "second-capability", dailyLimit: 10 },
      },
    }),
  );
  // Run the real broker on an ephemeral test port, leaving production binding
  // unchanged. None of these requests may reach an upstream provider.
  const source = await readFile(
    new URL("./broker.mjs", import.meta.url),
    "utf8",
  );
  const fixture = join(directory, "broker.mjs");
  await writeFile(
    join(directory, "anthropic-employee-payload.mjs"),
    await readFile(
      new URL("./anthropic-employee-payload.mjs", import.meta.url),
    ),
  );
  await writeFile(
    join(directory, "employee-admission.mjs"),
    await readFile(new URL("./employee-admission.mjs", import.meta.url)),
  );
  await writeFile(
    join(directory, "response-accounting.mjs"),
    await readFile(new URL("./response-accounting.mjs", import.meta.url)),
  );
  const upstreamBodies = [];
  const heldConcurrent = new Map();
  const captured = new EventEmitter();
  let heldResponse;
  let announceHeld;
  const heldRequest = new Promise((resolve) => {
    announceHeld = resolve;
  });
  const upstream = http.createServer(async (req, res) => {
    if (req.url === "/key" || req.url === "/credits") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data:
            req.url === "/key"
              ? {
                  usage_daily: 0.02,
                  usage: 0.05,
                  limit: 10,
                  limit_remaining: 9.95,
                }
              : { total_credits: 100, total_usage: 12 },
        }),
      );
      return;
    }
    if (req.method === "GET" && req.url === "/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data: ["allowed-model", "second-model"].map((id) => ({
            id,
            architecture: { output_modalities: ["text"] },
            context_length: 262144,
            pricing: { prompt: "0.000001", completion: "0.000001" },
          })),
        }),
      );
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    upstreamBodies.push({
      path: req.url,
      auth: req.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    const heldName =
      upstreamBodies.at(-1).body.input ??
      upstreamBodies.at(-1).body.messages?.[0]?.content;
    if (heldName === "terminal-before-eof") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        'data: {"type":"response.completed","response":{"usage":{"cost":0.002}}}\n\n',
      );
      // Deliberately leave HTTP open: the real native SDK cancels at this event.
      return;
    }
    if (
      typeof heldName === "string" &&
      heldName.startsWith("hold-concurrent-")
    ) {
      heldConcurrent.set(heldName, res);
      captured.emit(heldName);
      return;
    }
    if (
      upstreamBodies.at(-1).body.input?.[0]?.content?.[0]?.text ===
      "hold-image-buffer"
    ) {
      heldResponse = res;
      announceHeld();
      return;
    }
    if (upstreamBodies.at(-1).body.input === "reject-validation") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: "Provider returned error",
            metadata: {
              raw: JSON.stringify({
                error: { message: "Duplicate tool name" },
              }),
            },
          },
        }),
      );
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        type: "message",
        content: [{ type: "text", text: "OK" }],
        usage: { cost: 0.001 },
      }),
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  await writeFile(
    join(directory, "router-usage.mjs"),
    (
      await readFile(new URL("./router-usage.mjs", import.meta.url), "utf8")
    ).replaceAll(
      "https://openrouter.ai/api/v1/",
      `http://127.0.0.1:${upstream.address().port}/`,
    ),
  );
  assert.ok(source.includes('server.listen(3456, "127.0.0.1");'));
  await writeFile(
    fixture,
    source
      .replaceAll(
        "https://openrouter.ai/api/v1/",
        `http://127.0.0.1:${upstream.address().port}/`,
      )
      .replace(
        'server.listen(3456, "127.0.0.1");',
        'server.listen(0, "127.0.0.1", () => process.send(server.address().port));',
      ),
  );
  const child = spawn(process.execPath, [fixture], {
    env: { ...process.env, BROKER_CONFIG: config, BROKER_LEDGER: ledger },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  try {
    const [port] = await once(child, "message");
    const call = (
      body,
      token = "synthetic-capability",
      endpoint = "responses",
    ) =>
      fetch(`http://127.0.0.1:${port}/v1/${endpoint}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const largeHistory = "x".repeat(200000);
    assert.equal(
      (await call({ model: "wrong-model", input: largeHistory })).status,
      403,
    );
    // A payload that passed parsing still cannot spend beyond its daily cap.
    assert.equal(
      (await call({ model: "allowed-model", input: largeHistory })).status,
      424,
    );
    assert.equal(
      (await call({ model: "allowed-model" }, "wrong-capability")).status,
      401,
    );
    assert.equal(
      (
        await call({
          model: "allowed-model",
          input: "x".repeat(16 * 1024 * 1024),
        })
      ).status,
      413,
    );
    assert.equal((await call({ model: "wrong-model" })).status, 403);
    assert.equal(
      (
        await call(
          { model: "wrong-model", messages: [] },
          "bridge-capability",
          "messages?beta=true",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          {
            model: "allowed-model",
            messages: [],
            tools: [{ type: "web_search_20250305", name: "web_search" }],
          },
          "bridge-capability",
          "messages",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          { model: "allowed-model", messages: [] },
          "synthetic-capability",
          "messages",
        )
      ).status,
      424,
    );
    const good = await call(
      {
        model: "allowed-model",
        messages: [
          {
            role: "system",
            content: [
              { type: "text", text: "Preserve this system update" },
              {
                type: "tool_addition",
                tool: { name: "inline_tool", input_schema: { type: "object" } },
              },
              {
                type: "tool_removal",
                tool: { type: "tool_reference", name: "local_tool" },
              },
            ],
          },
          { role: "user", content: "OK" },
        ],
        max_tokens: 999999,
        metadata: { private: "not-forwarded" },
        thinking: { type: "enabled", budget_tokens: 99999 },
        tools: [{ name: "local_tool", input_schema: { type: "object" } }],
      },
      "bridge-capability",
      "messages?beta=true",
    );
    assert.equal(good.status, 200);
    assert.equal((await good.json()).content[0].text, "OK");
    assert.equal(upstreamBodies.length, 1);
    assert.equal(upstreamBodies[0].path, "/messages");
    assert.equal(upstreamBodies[0].auth, "Bearer unused-synthetic-key");
    assert.equal(upstreamBodies[0].body.max_tokens, 8192);
    assert.equal(upstreamBodies[0].body.model, "allowed-model");
    assert.equal(upstreamBodies[0].body.thinking, undefined);
    assert.equal(upstreamBodies[0].body.metadata, undefined);
    assert.deepEqual(
      upstreamBodies[0].body.tools.map((t) => t.name),
      ["inline_tool"],
    );
    assert.deepEqual(upstreamBodies[0].body.messages[0].content, [
      { type: "text", text: "Preserve this system update" },
    ]);
    const alternate = await call(
      {
        model: "second-model",
        input: [
          {
            type: "additional_tools",
            role: "developer",
            tools: [{ type: "function", name: "old_owner_tool" }],
          },
          { role: "user", content: "Preserve the conversation" },
        ],
        tools: [
          {
            type: "function",
            name: "current_scoped_tool",
            parameters: { type: "object" },
          },
        ],
        provider: { max_price: { prompt: 999 } },
      },
      "second-capability",
    );
    assert.equal(alternate.status, 200);
    await alternate.json();
    assert.equal(upstreamBodies[1].body.model, "second-model");
    assert.deepEqual(upstreamBodies[1].body.input, [
      { role: "user", content: "Preserve the conversation" },
    ]);
    assert.deepEqual(
      upstreamBodies[1].body.tools.map((t) => t.name),
      ["current_scoped_tool"],
    );
    assert.equal(upstreamBodies[1].body.provider.max_price.prompt, 1);
    const invalid = await call(
      { model: "second-model", input: "reject-validation" },
      "second-capability",
    );
    assert.equal(invalid.status, 424);
    assert.match((await invalid.json()).error.message, /Duplicate tool name/);
    const amounts = Object.entries(
      JSON.parse(await readFile(ledger, "utf8")),
    ).find(([key]) => key.endsWith(":second"))[1];
    assert.equal(amounts.requests, 2);
    assert.ok(
      Math.abs(amounts.spent - 0.001) < 1e-10,
      "Validation rejection releases its reservation",
    );
    // A native tool image must survive forwarding byte-for-byte beside history.
    // This realistic inline frame exceeded the old 2 MiB transport boundary.
    const nativeImage = "data:image/png;base64," + "A".repeat(3 * 1024 * 1024);
    const imageInput = [
      {
        role: "user",
        content: [{ type: "input_text", text: "Keep this history" }],
      },
      {
        type: "function_call_output",
        call_id: "image-preview",
        output: [{ type: "input_image", image_url: nativeImage }],
      },
    ];
    const withImage = await call(
      { model: "second-model", input: imageInput },
      "second-capability",
    );
    assert.equal(withImage.status, 200);
    await withImage.json();
    assert.deepEqual(upstreamBodies.at(-1).body.input, imageInput);
    // Rejection and successful completion must both release buffer admission.
    const next = await call(
      { model: "second-model", input: "After image" },
      "second-capability",
    );
    assert.equal(next.status, 200);
    await next.json();
    const largeImage = "data:image/png;base64," + "A".repeat(13 * 1024 * 1024);
    const held = call(
      {
        model: "allowed-model",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "hold-image-buffer" },
              { type: "input_image", image_url: largeImage },
            ],
          },
        ],
      },
      "bridge-capability",
    );
    await heldRequest;
    const status = async () =>
      (
        await fetch(`http://127.0.0.1:${port}/v1/status`, {
          headers: { authorization: "Bearer second-capability" },
        })
      ).json();
    const untilStatus = async (predicate) => {
      const deadline = Date.now() + 2000;
      while (true) {
        const state = await status();
        if (predicate(state)) return state;
        assert.ok(Date.now() < deadline, "Admission state failed to settle");
        await new Promise((resolve) => setImmediate(resolve));
      }
    };
    const beforeCancel = await status();
    const cancelled = http.request({
      host: "127.0.0.1",
      port,
      path: "/v1/responses",
      method: "POST",
      headers: {
        authorization: "Bearer second-capability",
        "content-length": 13 * 1024 * 1024,
        expect: "100-continue",
      },
    });
    cancelled.on("error", () => {});
    const continued = once(cancelled, "continue");
    cancelled.flushHeaders();
    await continued;
    await untilStatus((s) => s.queued === 1);
    const closed = new Promise((resolve) => cancelled.once("close", resolve));
    cancelled.destroy();
    await closed;
    const afterCancel = await untilStatus((s) => s.queued === 0);
    assert.equal(
      afterCancel.requestsToday,
      beforeCancel.requestsToday,
      "Cancelled queued requests spend no budget/call count",
    );
    const waiting = call(
      {
        model: "second-model",
        input: [
          {
            role: "user",
            content: [{ type: "input_image", image_url: largeImage }],
          },
        ],
      },
      "second-capability",
    );
    heldResponse.writeHead(200, { "content-type": "application/json" });
    heldResponse.end(JSON.stringify({ usage: { cost: 0.001 } }));
    await (await held).json();
    const recovered = await waiting;
    assert.equal(recovered.status, 200);
    await recovered.json();
    const beforeConcurrency = Object.entries(
      JSON.parse(await readFile(ledger, "utf8")),
    ).find(([key]) => key.endsWith(":bridge"))[1];
    const capturedA = once(captured, "hold-concurrent-a");
    const capturedB = once(captured, "hold-concurrent-b");
    const a = call(
      { model: "openrouter/auto", input: "hold-concurrent-a" },
      "bridge-capability",
    );
    const b = call(
      {
        model: "allowed-model",
        messages: [{ role: "user", content: "hold-concurrent-b" }],
        stream: true,
      },
      "bridge-capability",
      "messages",
    );
    // Both wire formats enter the same upstream concurrently for one employee.
    await Promise.all([capturedA, capturedB]);
    for (const [name, response] of heldConcurrent) {
      if (name === "hold-concurrent-b") {
        response.writeHead(200, { "content-type": "text/event-stream" });
        for (const event of [
          { type: "message_start", message: { usage: { input_tokens: 1 } } },
          { type: "message_delta", usage: { cost: 0.001, output_tokens: 1 } },
          { type: "message_stop" },
        ])
          response.write("data: " + JSON.stringify(event) + "\n\n");
        response.end();
      } else {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ usage: { cost: 0.001 } }));
      }
    }
    await Promise.all([a.then((r) => r.json()), b.then((r) => r.text())]);
    const afterConcurrency = Object.entries(
      JSON.parse(await readFile(ledger, "utf8")),
    ).find(([key]) => key.endsWith(":bridge"))[1];
    assert.equal(afterConcurrency.requests, beforeConcurrency.requests + 2);
    assert.ok(
      Math.abs(afterConcurrency.spent - beforeConcurrency.spent - 0.002) <
        1e-10,
    );
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: "Bearer bridge-capability",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "allowed-model",
        input: "terminal-before-eof",
        stream: true,
      }),
    });
    const reader = response.body.getReader();
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /response.completed/,
    );
    controller.abort();
    let afterTerminalCancel;
    for (let i = 0; i < 100; i++) {
      afterTerminalCancel = Object.entries(
        JSON.parse(await readFile(ledger, "utf8")),
      ).find(([key]) => key.endsWith(":bridge"))[1];
      if (
        Math.abs(
          afterTerminalCancel.confirmed - afterConcurrency.confirmed - 0.002,
        ) < 1e-10
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.ok(
      Math.abs(afterTerminalCancel.spent - afterConcurrency.spent - 0.002) <
        1e-10,
      "Terminal SSE cost must settle even when the SDK closes before HTTP EOF",
    );
    assert.equal(
      afterTerminalCancel.unverified ?? 0,
      afterConcurrency.unverified ?? 0,
    );
  } finally {
    const exited = once(child, "exit");
    child.kill();
    await exited;
    upstream.close();
    await rm(directory, { recursive: true, force: true });
  }
});
