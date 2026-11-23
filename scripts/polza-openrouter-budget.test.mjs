import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createOpenRouterGateway } from "./polza-openrouter-gateway.mjs";

const rejected = (requested = 32000, affordable = 4312) => ({
  error: {
    message: `This request requires more credits. You requested up to ${requested} tokens, but can only afford ${affordable}. Private key settings URL must not be forwarded.`,
  },
  metadata: { limit_source: "openrouter_credits" },
});

async function fixture(t, handler, adaptOutputBudget = true, options = {}) {
  const received = [];
  const upstream = http.createServer(async (req, res) => {
    let text = "";
    for await (const part of req) text += part;
    const body = JSON.parse(text);
    received.push(body);
    handler(body, res, received.length);
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const gateway = createOpenRouterGateway({
    upstreamBase: `http://127.0.0.1:${upstream.address().port}`,
    limitCooldowns: true,
    adaptOutputBudget,
    ...options,
  });
  await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
  t.after(() => {
    gateway.closeAllConnections();
    gateway.close();
    upstream.closeAllConnections();
    upstream.close();
  });
  return {
    received,
    post: (body, endpoint = "messages") =>
      fetch(`http://127.0.0.1:${gateway.address().port}/v1/${endpoint}`, {
        method: "POST",
        headers: { authorization: "Bearer local-fixture" },
        body: JSON.stringify(body),
      }),
  };
}
function fail(res, body = rejected()) {
  res.writeHead(402, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
function success(res) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}

for (const [field, endpoint] of [
  ["max_tokens", "messages"],
  ["max_output_tokens", "responses"],
  ["max_completion_tokens", "chat/completions"],
]) {
  test(`retries preflight once with a smaller ${field} and unchanged context/tools`, async (t) => {
    const f = await fixture(t, (_body, res, call) =>
      call === 1 ? fail(res) : success(res),
    );
    const original = {
      model: "fixture/manual-model",
      [field]: 32000,
      messages: [{ role: "user", content: "preserve the exact task" }],
      tools: [{ type: "function", name: "readonly_tool" }],
      output_config: { effort: "high" },
    };
    const r = await f.post(original, endpoint);
    assert.equal(r.status, 200);
    assert.equal(f.received.length, 2);
    assert.deepEqual(f.received[1], { ...original, [field]: 4096 });
  });
}

test("does not turn a reservation refusal into an account-wide cooldown; default does not resubmit", async (t) => {
  const f = await fixture(
    t,
    (body, res) => (body.max_tokens > 64 ? fail(res) : success(res)),
    false,
  );
  const bad = await f.post({ model: "fixture", max_tokens: 32000 });
  const error = await bad.json();
  assert.equal(bad.status, 402);
  assert.match(error.error.message, /32000.*4312/);
  assert(!error.error.message.includes("Private key"));
  assert.equal(f.received.length, 1);
  const small = await f.post({ model: "fixture", max_tokens: 64 });
  assert.equal(small.status, 200);
  assert.equal(f.received.length, 2);
});

test("a second credit refusal ends visibly without a retry loop", async (t) => {
  const f = await fixture(t, (body, res, call) =>
    fail(res, rejected(body.max_tokens, call === 1 ? 1024 : 512)),
  );
  const r = await f.post({ model: "fixture", max_tokens: 32000 });
  assert.equal(r.status, 402);
  assert.equal(f.received.length, 2);
  assert.match((await r.json()).error.message, /512/);
});

test("preserves explicit thinking budget and does not resubmit provider-origin billing failures", async (t) => {
  const f = await fixture(t, (_body, res, call) => {
    const error = rejected();
    if (call > 1) error.metadata.limit_source = "provider_credits";
    fail(res, error);
  });
  const r = await f.post({
    model: "fixture",
    max_tokens: 32000,
    thinking: { type: "enabled", budget_tokens: 5000 },
  });
  assert.equal(r.status, 402);
  assert.equal(f.received.length, 1);
  const second = await f.post({ model: "fixture", max_tokens: 32000 });
  assert.equal(second.status, 402);
  assert.equal(f.received.length, 2);
});

test("never resubmits a stream that has already started", async (t) => {
  const f = await fixture(t, (_body, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      `data: ${JSON.stringify({ error: { code: 402, ...rejected().error } })}\n\n`,
    );
  });
  const r = await f.post({ model: "fixture", max_tokens: 32000 });
  assert.match(await r.text(), /requested up to 32000/);
  assert.equal(f.received.length, 1);
});

test("input affordability never truncates history or creates a global cooldown", async (t) => {
  const f = await fixture(t, (_body, res, call) => {
    if (call === 1)
      fail(res, {
        error: {
          message:
            "Prompt tokens limit exceeded: 21638 > 13552. Private key URL",
        },
        metadata: { limit_source: "openrouter_credits" },
      });
    else success(res);
  });
  const body = {
    model: "fixture",
    max_tokens: 4096,
    messages: [{ role: "user", content: "keep my history" }],
  };
  const r = await f.post(body);
  assert.equal(r.status, 402);
  const error = (await r.json()).error.message;
  assert.match(error, /контекста.*21638.*13552/);
  assert(!error.includes("Private key"));
  assert.equal(f.received.length, 1);
  assert.deepEqual(f.received[0], body);
  assert.equal(
    (await f.post({ ...body, messages: [{ role: "user", content: "small" }] }))
      .status,
    200,
  );
});

test("operator cheap Auto preference preserves explicit plugin settings and manual models", async (t) => {
  const f = await fixture(t, (_body, res) => success(res), true, {
    autoAllowedModels: ["fixture/cheap"],
    autoCostTier: "low",
  });
  await f.post({ model: "openrouter/auto", max_tokens: 64 });
  assert.deepEqual(f.received.at(-1).plugins, [
    { id: "auto-router", allowed_models: ["fixture/cheap"], cost_tier: "low" },
  ]);
  const explicit = [
    {
      id: "auto-router",
      allowed_models: ["fixture/custom"],
      cost_tier: "high",
    },
  ];
  await f.post({ model: "openrouter/auto", plugins: explicit, max_tokens: 64 });
  assert.deepEqual(f.received.at(-1).plugins, explicit);
  await f.post({ model: "fixture/manual", max_tokens: 64 });
  assert.equal(f.received.at(-1).plugins, undefined);
});

test("only operator Auto can use its configured cheap route after a rejected preflight", async (t) => {
  const f = await fixture(
    t,
    (_body, res, call) => {
      if (call === 1)
        fail(res, {
          error: { message: "Prompt tokens limit exceeded: 21638 > 13552" },
          metadata: { limit_source: "openrouter_credits" },
        });
      else success(res);
    },
    true,
    {
      autoAllowedModels: ["fixture/cheap"],
      autoBudgetModel: "fixture/cheap",
    },
  );
  const original = {
    model: "openrouter/auto",
    max_tokens: 32000,
    messages: [{ role: "user", content: "entire history" }],
    tools: [{ name: "readonly_tool" }],
    output_config: { effort: "high" },
  };
  assert.equal((await f.post(original)).status, 200);
  assert.equal(f.received.length, 2);
  assert.equal(f.received[1].model, "fixture/cheap");
  assert.equal(f.received[1].max_tokens, 4096);
  assert.deepEqual(f.received[1].messages, original.messages);
  assert.deepEqual(f.received[1].tools, original.tools);
  assert.deepEqual(f.received[1].output_config, original.output_config);
});

test("budget routing never overrides a manual model or caller's Auto restrictions", async (t) => {
  const f = await fixture(t, (_body, res) => fail(res), true, {
    autoAllowedModels: ["fixture/cheap"],
    autoBudgetModel: "fixture/cheap",
  });
  const manual = await f.post({ model: "fixture/manual", max_tokens: 32000 });
  assert.equal(manual.status, 402);
  assert.equal(f.received.length, 2);
  assert.equal(f.received[1].model, "fixture/manual");
  const explicit = await f.post({
    model: "openrouter/auto",
    max_tokens: 32000,
    plugins: [{ id: "auto-router", allowed_models: ["fixture/restricted"] }],
  });
  assert.equal(explicit.status, 402);
  assert.equal(f.received.length, 4);
  assert.equal(f.received[3].model, "openrouter/auto");
  assert.deepEqual(f.received[3].plugins, f.received[2].plugins);
});
