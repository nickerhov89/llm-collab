import assert from "node:assert/strict";
import test from "node:test";
import { RouterUsage } from "./router-usage.mjs";

test("billing reads actual key costs, coalesces reads and never exposes keys", async () => {
  const calls = [];
  let failed = false;
  const client = new RouterUsage("private-test-key", async (url) => {
    calls.push(url);
    if (failed) return new Response("unavailable", { status: 503 });
    return Response.json({
      data: url.endsWith("/key")
        ? {
            usage_daily: 0.975,
            usage: 1.77,
            limit: 10,
            limit_remaining: 8.23,
            label: "SECRET_LABEL",
          }
        : { total_credits: 255, total_usage: 248.37 },
    });
  });
  const [a, b] = await Promise.all([client.get(), client.get()]);
  assert.equal(a, b);
  assert.equal(calls.length, 2);
  assert.equal(a.spentToday, 0.975);
  assert.ok(Math.abs(a.creditBalance - 6.63) < 0.00001);
  assert.ok(!JSON.stringify(a).includes("private-test-key"));
  assert.ok(!JSON.stringify(a).includes("SECRET_LABEL"));
  await client.get();
  assert.equal(calls.length, 2);
  client.snapshot.fetchedAt = new Date(0).toISOString();
  failed = true;
  const stale = await client.get();
  assert.equal(stale.spentToday, 0.975);
  assert.equal(stale.stale, true);
  const cold = new RouterUsage(
    "private-test-key",
    async () => new Response("", { status: 401 }),
  );
  assert.equal(await cold.get(), null);
});

test("generation costs require matching provider identity and valid finite cost", async () => {
  let cost = 0.012;
  let id = "gen-123-verified";
  const calls = [];
  const client = new RouterUsage("private-test-key", async (url) => {
    calls.push(url);
    return Response.json({ data: { id, total_cost: cost } });
  });
  assert.equal(await client.generation("../../key"), null);
  assert.equal(calls.length, 0);
  assert.equal(await client.generation("resp_gen-123-verified"), cost);
  id = "gen-wrong";
  assert.equal(await client.generation("gen-123-verified"), null);
  id = "gen-123-verified";
  cost = -1;
  assert.equal(await client.generation(id), null);
});
