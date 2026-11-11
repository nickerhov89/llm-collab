#!/usr/bin/env node
import { readFile } from "node:fs/promises";

export function summarizeEvents(events) {
  const normalized = events.map((event) => {
    const legacyReview =
      !event.eventType &&
      (event.outcome || event.reason === "agent-observed-result");
    const oldUsage = event.tokenUsage && "input" in event.tokenUsage;
    return {
      ...event,
      eventType: event.eventType ?? (legacyReview ? "review" : "attempt"),
      routeSource: event.routeSource ?? "legacy-unknown",
      ...(oldUsage
        ? {
            tokenUsage: {
              freshInput: Math.max(
                0,
                (Number(event.tokenUsage.input) || 0) -
                  (Number(event.tokenUsage.cachedInput) || 0),
              ),
              cachedInput: Number(event.tokenUsage.cachedInput) || 0,
              cacheWrite: 0,
              output: Number(event.tokenUsage.output) || 0,
            },
          }
        : {}),
    };
  });
  const attempts = normalized.filter(
    (event) => event.eventType === "attempt" && event.taskId && event.provider,
  );
  const reviews = normalized.filter((event) => event.eventType === "review");
  const groups = new Map();
  for (const event of attempts) {
    const key = [
      event.task,
      event.routeSource,
      event.provider,
      event.model,
    ].join("/");
    const row = groups.get(key) ?? {
      task: event.task ?? "unknown",
      routeSource: event.routeSource ?? "unknown",
      provider: event.provider ?? "unknown",
      model: event.model ?? "unknown",
      attempts: 0,
      tasks: new Set(),
      structuralChecks: 0,
      structuralPasses: 0,
      humanReviews: 0,
      humanPasses: 0,
      humanFailures: 0,
      usageAvailable: 0,
      freshInput: 0,
      cachedInput: 0,
      cacheWrite: 0,
      output: 0,
      apiEquivalentUsd: 0,
      apiEquivalentKnown: 0,
      actualCostUsd: null,
      latencyMs: 0,
    };
    row.attempts++;
    row.tasks.add(event.taskId);
    row.latencyMs += Number(event.durationMs) || 0;
    if (typeof event.passed === "boolean") {
      row.structuralChecks++;
      if (event.passed) row.structuralPasses++;
    }
    if (event.tokenUsage) {
      row.usageAvailable++;
      row.freshInput += Number(event.tokenUsage.freshInput) || 0;
      row.cachedInput += Number(event.tokenUsage.cachedInput) || 0;
      row.cacheWrite += Number(event.tokenUsage.cacheWrite) || 0;
      row.output += Number(event.tokenUsage.output) || 0;
    }
    if (typeof event.apiEquivalentCostUsd === "number") {
      row.apiEquivalentUsd += event.apiEquivalentCostUsd;
      row.apiEquivalentKnown++;
    }
    groups.set(key, row);
  }
  for (const event of reviews) {
    const key = [
      event.task,
      event.routeSource,
      event.provider,
      event.model,
    ].join("/");
    const row = groups.get(key) ?? {
      task: event.task ?? "unknown",
      routeSource: event.routeSource ?? "unknown",
      provider: event.provider ?? "unknown",
      model: event.model ?? "unknown",
      attempts: 0,
      tasks: new Set(),
      structuralChecks: 0,
      structuralPasses: 0,
      humanReviews: 0,
      humanPasses: 0,
      humanFailures: 0,
      usageAvailable: 0,
      freshInput: 0,
      cachedInput: 0,
      cacheWrite: 0,
      output: 0,
      apiEquivalentUsd: 0,
      apiEquivalentKnown: 0,
      actualCostUsd: null,
      latencyMs: 0,
      manualReviewOnly: true,
    };
    groups.set(key, row);
  }
  for (const row of groups.values()) {
    const matchingReviews = reviews.filter(
      (review) =>
        review.task === row.task &&
        review.routeSource === row.routeSource &&
        review.provider === row.provider &&
        review.model === row.model &&
        review.passed !== null,
    );
    row.humanReviews = matchingReviews.length;
    row.humanPasses = matchingReviews.filter((review) => review.passed).length;
    row.humanFailures = matchingReviews.filter(
      (review) => !review.passed,
    ).length;
    row.tasks = row.tasks.size;
    row.avgLatencyMs = row.attempts
      ? Math.round(row.latencyMs / row.attempts)
      : 0;
    row.apiEquivalentIncomplete = row.apiEquivalentKnown < row.attempts;
    row.usageCoverage = row.attempts ? row.usageAvailable / row.attempts : null;
    delete row.latencyMs;
  }
  const tasks = new Set(attempts.map((event) => event.taskId));
  const retried = new Set(
    attempts.filter((event) => event.attempt > 1).map((event) => event.taskId),
  );
  return {
    attempts: attempts.length,
    tasks: tasks.size,
    tasksWithFallback: retried.size,
    fallbackRate: tasks.size ? retried.size / tasks.size : null,
    reviews: reviews.filter((event) => event.passed !== null).length,
    groups: [...groups.values()].sort(
      (a, b) =>
        a.task.localeCompare(b.task) || a.provider.localeCompare(b.provider),
    ),
    accounting: {
      actualSpendUsd: null,
      actualSpendStatus: "unavailable-from-cli-token-telemetry",
      apiEquivalentIsNotActualSpend: true,
    },
  };
}

async function main() {
  const file =
    process.argv[2] ??
    `${process.env.HOME}/.local/state/polza-model-router/events.jsonl`;
  let raw = "";
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const events = raw.split("\n").flatMap((line) => {
    try {
      return line ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
  console.log(JSON.stringify({ file, ...summarizeEvents(events) }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
