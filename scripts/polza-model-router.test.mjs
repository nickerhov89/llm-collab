import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseRoute,
  classifyFailure,
  parseUsage,
  routeTask,
  parseAnswer,
} from "./polza-model-router.mjs";
import { summarizeEvents } from "./polza-router-report.mjs";

test("private routes never send data to Google or OpenRouter", () => {
  for (const task of ["code", "writing", "analysis", "extract", "general"])
    assert.ok(
      chooseRoute({ task }).every((candidate) =>
        ["claude", "codex"].includes(candidate.provider),
      ),
    );
  assert.equal(chooseRoute({ task: "writing" })[0].model, "haiku");
  assert.equal(chooseRoute({ task: "code" })[0].model, "gpt-6-luna");
  assert.equal(
    chooseRoute({ task: "general", publicData: true })[0].provider,
    "gemini",
  );
});
test("an accepted cheap answer stops escalation and logs no prompt or result", async () => {
  const records = [];
  let calls = 0;
  const result = await routeTask(
    {
      task: "writing",
      prompt: "private customer details",
      requiredKeys: ["subject"],
    },
    {
      run: async () => {
        calls++;
        return { exitCode: 0, answer: '{"subject":"private answer"}' };
      },
      record: async (event) => records.push(event),
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.selected.model, "haiku");
  assert.equal(records[0].passed, true);
  assert.ok(!JSON.stringify(records).includes("private customer"));
  assert.ok(!JSON.stringify(records).includes("private answer"));
  assert.equal(records[0].actualCostUsd, null);
});
test("a failed acceptance check escalates once using the same bounded input", async () => {
  const calls = [];
  const result = await routeTask(
    { task: "code", prompt: "synthetic task", requiredKeys: ["answer"] },
    {
      run: async (selected) => {
        calls.push(selected);
        return {
          exitCode: 0,
          answer: calls.length === 1 ? "not json" : '{"answer":42}',
        };
      },
    },
  );
  assert.deepEqual(
    calls.map((c) => c.model),
    ["gpt-6-luna", "gpt-6.1-sol"],
  );
  assert.equal(result.events[0].passed, false);
  assert.equal(result.events[1].passed, true);
});
test("runtime failures stop after the eligible chain, without fabricated output", async () => {
  const result = await routeTask(
    { task: "general", prompt: "synthetic" },
    {
      run: async () => {
        throw new Error("sensitive provider error");
      },
    },
  );
  assert.equal(result.selected, null);
  assert.equal(result.events.length, 2);
  assert.ok(
    !JSON.stringify(result.events).includes("sensitive provider error"),
  );
});
test("extracts only assistant text and rejects provider error envelopes", () => {
  assert.equal(
    parseAnswer(
      "codex",
      '{"type":"item.completed","item":{"type":"reasoning","text":"hidden"}}\n{"type":"item.completed","item":{"type":"agent_message","text":"answer"}}',
    ),
    "answer",
  );
  assert.throws(() =>
    parseAnswer("claude", '{"is_error":true,"result":"error"}'),
  );
  assert.equal(parseAnswer("gemini", '{"response":"answer"}'), "answer");
});

test("records only bounded usage metadata and distinguishes unavailable models from bad answers", () => {
  assert.equal(classifyFailure("429 quota exceeded"), "rate-limit");
  assert.equal(classifyFailure("401 authentication required"), "auth-required");
  assert.equal(classifyFailure("404 model not found"), "model-unavailable");
  assert.deepEqual(
    parseUsage(
      "claude",
      JSON.stringify({
        modelUsage: { "claude-haiku-5-5": {} },
        usage: { input_tokens: 12, output_tokens: 3 },
        total_cost_usd: 0.001,
        result: "private answer",
      }),
    ),
    {
      reportedModel: "claude-haiku-5-5",
      reportedModels: ["claude-haiku-5-5"],
      apiEquivalentCostUsd: 0.001,
      apiEquivalentCostBasis: "provider-reported-list-equivalent",
      tokenUsage: { freshInput: 12, cachedInput: 0, cacheWrite: 0, output: 3 },
    },
  );
});

test("parses Claude aggregate model usage and Codex token-count events", () => {
  const claude = parseUsage(
    "claude",
    JSON.stringify({
      modelUsage: {
        "claude-haiku-5-5": {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadInputTokens: 40,
          cacheCreationInputTokens: 10,
          costUSD: 0.002,
        },
      },
      result: "private answer",
    }),
  );
  assert.deepEqual(claude.tokenUsage, {
    freshInput: 50,
    cachedInput: 40,
    cacheWrite: 10,
    output: 20,
  });
  assert.equal(claude.apiEquivalentCostUsd, 0.002);

  const codex = parseUsage(
    "codex",
    [
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 120,
              cached_input_tokens: 80,
              cache_write_input_tokens: 5,
              output_tokens: 30,
            },
          },
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "not included" },
      }),
    ].join("\n"),
  );
  assert.deepEqual(codex.tokenUsage, {
    freshInput: 35,
    cachedInput: 80,
    cacheWrite: 5,
    output: 30,
  });
});

test("router report separates structural checks, human review, and API-equivalent cost", () => {
  const report = summarizeEvents([
    {
      eventType: "attempt",
      taskId: "a",
      task: "analysis",
      routeSource: "helper-auto",
      provider: "claude",
      model: "haiku",
      attempt: 1,
      passed: true,
      durationMs: 10,
      apiEquivalentCostUsd: 0.01,
      actualCostUsd: null,
      tokenUsage: { freshInput: 10 },
    },
    {
      eventType: "attempt",
      taskId: "b",
      task: "code",
      routeSource: "helper-auto",
      provider: "codex",
      model: "luna",
      attempt: 1,
      passed: false,
      durationMs: 20,
      apiEquivalentCostUsd: 0.02,
      actualCostUsd: null,
    },
    {
      eventType: "attempt",
      taskId: "b",
      task: "code",
      routeSource: "helper-auto",
      provider: "codex",
      model: "sol",
      attempt: 2,
      passed: true,
      durationMs: 40,
      apiEquivalentCostUsd: 0.03,
      actualCostUsd: null,
    },
    {
      eventType: "review",
      taskId: "a",
      task: "analysis",
      routeSource: "helper-auto",
      provider: "claude",
      model: "haiku",
      passed: false,
    },
  ]);
  assert.equal(report.fallbackRate, 0.5);
  assert.equal(report.accounting.actualSpendUsd, null);
  assert.equal(report.accounting.apiEquivalentIsNotActualSpend, true);
  assert.equal(
    report.groups.find((r) => r.provider === "claude").humanFailures,
    1,
  );
});

test("route policy exposes measurable categories without mixing auto and manual routes", () => {
  for (const task of ["code", "writing", "analysis", "extract", "general"]) {
    assert.ok(chooseRoute({ task }).length >= 1);
  }
  const report = summarizeEvents([
    {
      taskId: "old",
      task: "writing",
      provider: "claude",
      model: "haiku",
      attempt: 1,
      tokenUsage: { input: 120, cachedInput: 80, output: 15 },
      actualCostUsd: null,
    },
    {
      taskId: "review",
      task: "writing",
      provider: "claude",
      model: "haiku",
      outcome: "passed",
      passed: true,
      acceptance: "review",
      reason: "agent-observed-result",
    },
  ]);
  assert.equal(report.groups[0].routeSource, "legacy-unknown");
  assert.equal(report.groups[0].freshInput, 40);
  assert.equal(report.groups[0].humanPasses, 1);
});

test("an answer without a supplied acceptance check remains unverified", async () => {
  const result = await routeTask(
    { task: "writing", prompt: "synthetic task" },
    { run: async () => ({ exitCode: 0, answer: "a draft" }) },
  );
  assert.equal(result.selected.model, "haiku");
  assert.equal(result.events[0].passed, null);
  assert.equal(result.events[0].reviewRequired, true);
});
test("a failed external review can escalate once and preserve the task identity", async () => {
  const taskId = "00000000-0000-4000-8000-000000000001";
  let calls = 0;
  const result = await routeTask(
    { task: "code", prompt: "synthetic correction", escalate: true, taskId },
    {
      run: async () => {
        calls++;
        return { exitCode: 0, answer: "corrected draft" };
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.taskId, taskId);
  assert.equal(result.selected.model, "gpt-6.1-sol");
  assert.equal(result.events[0].reason, "explicit-escalation-after-review");
  assert.equal(result.events[0].routeStep, 2);
});
