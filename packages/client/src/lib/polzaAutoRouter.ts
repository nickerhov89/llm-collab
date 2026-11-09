import type { EffortLevel, ModelInfo, ProviderInfo, ProviderName } from "@yep-anywhere/shared";

/**
 * Polza's initial routing policy. Quality is deliberately not invented: a
 * candidate can win on measured cost per accepted answer only after a real,
 * language-specific evaluation has been recorded. Until then these are
 * conservative task defaults, not benchmark results.
 */
export type PolzaTask = "chain" | "code" | "analysis" | "general";
export type PolzaLanguage = "ru" | "en";

export interface PolzaBenchmark {
  task: PolzaTask;
  language: PolzaLanguage;
  provider: ProviderName;
  model: string;
  effort: EffortLevel;
  evaluated: number;
  accepted: number;
  averageEditingMinutes: number;
  averageInputTokens: number;
  averageOutputTokens: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export interface PolzaAutoRoute {
  provider: ProviderName;
  model: string;
  effort: EffortLevel;
  task: PolzaTask;
  language: PolzaLanguage;
  basis: "benchmark" | "starter-policy";
}

// This list is empty until matched tasks have been judged by specialists.
// Populate it from a versioned, reviewed evaluation export, never synthetic
// scores or an LLM's self-grades.
export const POLZA_ROUTER_BENCHMARKS: readonly PolzaBenchmark[] = [];

export function classifyPolzaTask(text: string): { task: PolzaTask; language: PolzaLanguage } {
  const normalized = text.toLowerCase();
  const explicitEnglish = /(?:на английском|англоязыч|english|\ben\b|для англоязыч|для (?:сша|американск|британск|великобритани|us\b|uk\b)|на рынок (?:сша|us\b|uk\b))/i.test(normalized);
  const explicitRussian = /(?:на русском|русскоязыч|russian|\bru\b)/i.test(normalized);
  const language: PolzaLanguage = explicitEnglish ? "en" : explicitRussian ? "ru" : /[а-яё]/i.test(text) ? "ru" : "en";
  if (/(?:цепоч|письм|рассылк|аутрич|cold email|outreach|sequence|email campaign)/i.test(normalized)) return { task: "chain", language };
  if (/(?:код|репозитор|почин|исправ|деплой|верстк|api|bug|code|deploy|implement)/i.test(normalized)) return { task: "code", language };
  if (/(?:анализ|исслед|стратег|гипотез|метрик|сравн|research|analyse|analyz|strategy|report)/i.test(normalized)) return { task: "analysis", language };
  return { task: "general", language };
}

function pickModel(provider: ProviderInfo, patterns: readonly RegExp[], allowDefault = true): ModelInfo | undefined {
  const models = provider.models ?? [];
  for (const pattern of patterns) {
    const found = models.find((model) => pattern.test(model.id));
    if (found) return found;
  }
  return allowDefault ? models.find((model) => model.isDefault) ?? models[0] : undefined;
}

function compatibleEffort(model: ModelInfo, preferred: EffortLevel): EffortLevel {
  const supported = model.supportedReasoningEfforts?.map((entry) => entry.reasoningEffort);
  if (!supported?.length || supported.includes(preferred)) return preferred;
  return (supported.find((level): level is EffortLevel =>
    ["low", "medium", "high", "xhigh", "max"].includes(level)
  ) ?? "medium");
}

function benchmarkCostPerAccepted(row: PolzaBenchmark): number {
  if (row.evaluated < 12 || row.accepted < 1 || row.accepted / row.evaluated < 0.8) return Infinity;
  const apiCost = (row.averageInputTokens * row.inputUsdPerMillion + row.averageOutputTokens * row.outputUsdPerMillion) / 1_000_000;
  // Editing time is a configurable business input; one minute = $0.50 here.
  // It is an optimization weight, not a claim about a specialist's wage.
  return (apiCost + row.averageEditingMinutes * 0.5) / (row.accepted / row.evaluated);
}

export function choosePolzaAutoRoute(
  text: string,
  providers: readonly ProviderInfo[],
  benchmarks: readonly PolzaBenchmark[] = POLZA_ROUTER_BENCHMARKS,
): PolzaAutoRoute | null {
  const { task, language } = classifyPolzaTask(text);
  const available = providers.filter((provider) =>
    provider.name !== "gemini" &&
    provider.name !== "gemini-acp" &&
    provider.installed &&
    (provider.authenticated || provider.enabled)
  );
  if (available.length === 0) return null;

  const measured = benchmarks
    .filter((row) => row.task === task && row.language === language && available.some((provider) => provider.name === row.provider && provider.models?.some((model) => model.id === row.model && (!model.supportedReasoningEfforts?.length || model.supportedReasoningEfforts.some((effort) => effort.reasoningEffort === row.effort)))))
    .map((row) => ({ row, cost: benchmarkCostPerAccepted(row) }))
    .filter(({ cost }) => Number.isFinite(cost))
    .sort((a, b) => a.cost - b.cost)[0]?.row;
  if (measured) return { provider: measured.provider, model: measured.model, effort: measured.effort, task, language, basis: "benchmark" };

  // Free Gemini API is excluded from project routing until a paid/private-data
  // configuration is verified. Its advertised zero dollar cost is not a safe
  // basis for handling client briefs or conversations.
  const starter: ReadonlyArray<{ provider: ProviderName; models: readonly RegExp[]; effort: EffortLevel }> =
    task === "chain"
      ? [
          { provider: "claude", models: [/^sonnet$/, /sonnet-5-5/, /sonnet/], effort: "medium" },
          { provider: "codex", models: [/^gpt-6\.1-sol$/, /^gpt-6-sol$/, /sol/], effort: "medium" },
        ]
      : task === "code"
        ? [
            { provider: "codex", models: [/^gpt-6\.1-sol$/, /^gpt-6-sol$/, /sol/], effort: "medium" },
            { provider: "claude", models: [/^sonnet$/, /sonnet/], effort: "medium" },
          ]
        : task === "analysis"
          ? [
              { provider: "codex", models: [/^gpt-6\.1-sol$/, /^gpt-6-sol$/, /sol/], effort: "high" },
              { provider: "claude", models: [/^sonnet$/, /sonnet/], effort: "high" },
            ]
          : [
              { provider: "codex", models: [/^gpt-6-luna$/, /luna/, /^gpt-6\.1-sol$/, /sol/], effort: "low" },
              { provider: "claude", models: [/^haiku$/, /haiku/, /^sonnet$/], effort: "low" },
            ];

  for (const candidate of starter) {
    const provider = available.find((item) => item.name === candidate.provider);
    if (!provider) continue;
    const model = pickModel(provider, candidate.models, false);
    if (model) return { provider: provider.name, model: model.id, effort: compatibleEffort(model, candidate.effort), task, language, basis: "starter-policy" };
  }
  const fallback = available[0];
  if (!fallback) return null;
  const model = pickModel(fallback, []);
  return model ? { provider: fallback.name, model: model.id, effort: compatibleEffort(model, "medium"), task, language, basis: "starter-policy" } : null;
}
