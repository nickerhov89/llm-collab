import { describe, expect, it } from "vitest";
import type { ProviderInfo } from "@yep-anywhere/shared";
import { choosePolzaAutoRoute, classifyPolzaTask, type PolzaBenchmark } from "../polzaAutoRouter";

const providers: ProviderInfo[] = [
  { name: "codex", displayName: "Codex", installed: true, authenticated: true, enabled: true, models: [
    { id: "gpt-6-luna", name: "GPT-6 Luna", supportedReasoningEfforts: [{ reasoningEffort: "low" }] },
    { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }, { reasoningEffort: "high" }] },
  ] },
  { name: "claude", displayName: "Claude", installed: true, authenticated: true, enabled: true, models: [
    { id: "sonnet", name: "Claude Sonnet", supportedReasoningEfforts: [{ reasoningEffort: "medium" }] },
  ] },
  { name: "gemini", displayName: "Gemini", installed: true, authenticated: true, enabled: true, models: [
    { id: "gemini-2.5-flash", name: "Gemini Flash" },
  ] },
];

describe("Polza auto routing", () => {
  it("keeps chain language separate from the language of the instruction", () => {
    expect(classifyPolzaTask("Напиши цепочку на английском для B2B агентств")).toEqual({ task: "chain", language: "en" });
    expect(classifyPolzaTask("Подготовь русскую цепочку писем")).toEqual({ task: "chain", language: "ru" });
    expect(classifyPolzaTask("Напиши цепочку для США по этому брифу")).toEqual({ task: "chain", language: "en" });
  });

  it("uses a conservative starter route without pretending there is benchmark evidence", () => {
    expect(choosePolzaAutoRoute("Подготовь цепочку писем", providers)).toMatchObject({ provider: "claude", model: "sonnet", basis: "starter-policy" });
    expect(choosePolzaAutoRoute("Исправь код API", providers)).toMatchObject({ provider: "codex", model: "gpt-6.1-sol", basis: "starter-policy" });
    const withoutSonnet = providers.map((provider) => provider.name === "claude" ? { ...provider, models: [{ id: "haiku", name: "Claude Haiku" }] } : provider);
    expect(choosePolzaAutoRoute("Подготовь цепочку писем", withoutSonnet)).toMatchObject({ provider: "codex", model: "gpt-6.1-sol" });
  });

  it("switches to a cheaper accepted route only with enough matched human evaluations", () => {
    const row: PolzaBenchmark = { task: "chain", language: "ru", provider: "codex", model: "gpt-6.1-sol", effort: "medium", evaluated: 20, accepted: 19, averageEditingMinutes: 1, averageInputTokens: 3000, averageOutputTokens: 800, inputUsdPerMillion: 2, outputUsdPerMillion: 10 };
    expect(choosePolzaAutoRoute("Цепочка на русском", providers, [row])).toMatchObject({ provider: "codex", basis: "benchmark" });
    expect(choosePolzaAutoRoute("Цепочка на английском", providers, [row])).toMatchObject({ provider: "claude", basis: "starter-policy" });
    expect(choosePolzaAutoRoute("Цепочка на русском", providers, [{ ...row, evaluated: 8 }])).toMatchObject({ provider: "claude", basis: "starter-policy" });
  });
});
