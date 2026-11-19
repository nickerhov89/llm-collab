import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createOpenRouterGateway } from "./polza-openrouter-gateway.mjs";
async function setup(t, handler) {
  const upstream = http.createServer(handler);
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  let clock = 0;
  const gateway = createOpenRouterGateway({
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    limitCooldowns: true,
    now: () => clock,
  });
  await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
  t.after(() => {
    gateway.closeAllConnections();
    gateway.close();
    upstream.closeAllConnections();
    upstream.close();
  });
  return {
    tick: (n) => (clock = n),
    send: (model, key = "fixture") =>
      fetch(`http://127.0.0.1:${gateway.address().port}/v1/responses`, {
        method: "POST",
        headers: {
          authorization: "Bearer " + key,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: [{ role: "user", content: "synthetic private text" }],
        }),
      }),
  };
}
test("429 cooldown honors Retry-After, keeps models and credentials independent, and recovers on demand", async (t) => {
  let calls = 0;
  const f = await setup(t, async (req, res) => {
    for await (const _c of req) {
    }
    calls++;
    res.writeHead(calls === 1 ? 429 : 200, {
      "content-type": "application/json",
      "retry-after": "5",
    });
    res.end("{}");
  });
  let r = await f.send("model-a");
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("retry-after"), "5");
  assert.equal((await r.json()).error.code, "rate_limit_exceeded");
  r = await f.send("model-a");
  assert.equal(r.status, 429);
  assert.equal(calls, 1);
  assert.equal((await f.send("model-b")).status, 200);
  assert.equal((await f.send("model-a", "other")).status, 200);
  assert.equal(calls, 3);
  f.tick(5001);
  assert.equal((await f.send("model-a")).status, 200);
  assert.equal(calls, 4);
});
test("402 blocks other models on the same key without replaying or exposing upstream text", async (t) => {
  let calls = 0;
  const f = await setup(t, async (req, res) => {
    for await (const _c of req) {
    }
    calls++;
    res.writeHead(calls === 1 ? 402 : 200, {
      "content-type": "application/json",
    });
    res.end('{"error":{"message":"private upstream diagnostic"}}');
  });
  let r = await f.send("model-a");
  assert.equal(r.status, 402);
  assert.doesNotMatch(await r.text(), /private upstream diagnostic/);
  r = await f.send("model-b");
  assert.equal(r.status, 402);
  assert.equal(calls, 1);
  assert.equal((await f.send("model-b", "other")).status, 200);
  f.tick(30001);
  assert.equal((await f.send("model-b")).status, 200);
  assert.equal(calls, 3);
});
test("HTTP 200 SSE quota errors are passed intact and block the next request", async (t) => {
  let calls = 0;
  const wire =
    'event: error\ndata: {"type":"error","error":{"type":"rate_limit_error","message":"limit"}}\n\n';
  const f = await setup(t, async (req, res) => {
    for await (const _c of req) {
    }
    calls++;
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const char of wire) res.write(char);
    res.end();
  });
  const first = await f.send("model-a");
  assert.equal(first.status, 200);
  assert.equal(await first.text(), wire);
  assert.equal((await f.send("model-a")).status, 429);
  assert.equal(calls, 1);
});
