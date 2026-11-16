import type { ModelInfo } from "@yep-anywhere/shared";
export const EMPLOYEE_DEFAULT_MODEL = "qwen/qwen3-coder";
export function employeeModelId(model?: string): string {
  if (!model || model === "default") return EMPLOYEE_DEFAULT_MODEL;
  if (model.includes("/")) return model;
  if (model.startsWith("claude-")) return `anthropic/${model}`;
  if (/^(gpt-|o\d)/.test(model)) return `openai/${model}`;
  return EMPLOYEE_DEFAULT_MODEL;
}
export async function employeeModels(): Promise<ModelInfo[]> {
  const response = await fetch("http://127.0.0.1:3456/v1/models", {
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error("Employee model catalog unavailable");
  const body = (await response.json()) as {
    data: Array<{
      id: string;
      name?: string;
      context_length?: number;
      supported_parameters?: string[];
    }>;
  };
  return body.data.map((m) => ({
    id: m.id,
    name: m.name ?? m.id,
    contextWindow: m.context_length,
    supportsEffort: m.supported_parameters?.includes("reasoning"),
  }));
}
