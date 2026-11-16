import { DEDICATED_EMPLOYEE_RUNTIME } from "../../auth/dedicatedEmployeeRuntime.js";
import { employeeModelId } from "./employee-models.js";

export const EMPLOYEE_CLAUDE_MODEL = "qwen/qwen3-coder";

/** Native Claude history is a transport format, not an Anthropic entitlement. */
export function employeeClaudeEnvironment(
  model?: string,
): Record<string, string> {
  if (!DEDICATED_EMPLOYEE_RUNTIME) return {};
  const token = process.env.OPENAI_API_KEY;
  if (!token) throw new Error("Employee model capability is unavailable");
  const selected = employeeModelId(model);
  return {
    ANTHROPIC_BASE_URL: "http://127.0.0.1:3456",
    ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_MODEL: selected,
    ANTHROPIC_DEFAULT_OPUS_MODEL: selected,
    ANTHROPIC_DEFAULT_SONNET_MODEL: selected,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: selected,
    ANTHROPIC_SMALL_FAST_MODEL: selected,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: "2048",
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: "262144",
    CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: "1",
  };
}
