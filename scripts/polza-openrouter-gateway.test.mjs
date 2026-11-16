import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
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
