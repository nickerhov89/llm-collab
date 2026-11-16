import { spawn } from "node:child_process";
import { once } from "node:events";
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
        bridge: { token: "bridge-capability", dailyLimit: 1 },
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
  const upstreamBodies = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    upstreamBodies.push({
      path: req.url,
      auth: req.headers.authorization,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
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
  assert.ok(source.includes('server.listen(3456, "127.0.0.1");'));
  await writeFile(
    fixture,
    source
      .replace(
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
      429,
    );
    assert.equal(
      (await call({ model: "allowed-model" }, "wrong-capability")).status,
      401,
    );
    assert.equal(
      (
        await call({
          model: "allowed-model",
          input: "x".repeat(2 * 1024 * 1024),
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
    assert.equal(upstreamBodies[0].body.max_tokens, 2048);
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
  } finally {
    const exited = once(child, "exit");
    child.kill();
    await exited;
    upstream.close();
    await rm(directory, { recursive: true, force: true });
  }
});
