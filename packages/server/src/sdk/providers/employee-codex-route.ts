import { tomlString } from "@yep-anywhere/shared";
import { DEDICATED_EMPLOYEE_RUNTIME } from "../../auth/dedicatedEmployeeRuntime.js";
import { getDefaultCodexSessionsDir } from "../../projects/codex-scanner.js";
import { CodexSessionReader } from "../../sessions/codex-reader.js";
import { readCodexSessionMeta } from "../../sessions/codex-rollout-lineage.js";

/** Preserve native thread identity while keeping every staff route on its broker. */
export async function employeeCodexRouteArguments(
  resumeSessionId?: string,
): Promise<string[]> {
  if (!DEDICATED_EMPLOYEE_RUNTIME) return [];
  let provider = "polza_employee";
  if (resumeSessionId) {
    const reader = new CodexSessionReader({
      sessionsDir:
        process.env.CODEX_SESSIONS_DIR ?? getDefaultCodexSessionsDir(),
    });
    const file = await reader.getSessionFilePath(resumeSessionId);
    if (!file) throw new Error("Cannot locate employee Codex resume history");
    const meta = await readCodexSessionMeta(file);
    provider = meta.payload.model_provider ?? "openai";
    if (
      meta.payload.id !== resumeSessionId ||
      !/^[a-zA-Z0-9_-]+$/.test(provider)
    ) {
      throw new Error("Invalid employee Codex resume provider identity");
    }
  }
  // Codex 0.167 checks the saved provider against the process selection on
  // resume AND on input. A thread-only override cannot satisfy that check.
  // The native name is an alias, never a source of endpoint/auth settings.
  // The broker is HTTP-only; surface bounded failures rather than cycling
  // WebSocket fallback or silently retrying budget/provider denials.
  return [
    "-c",
    `model_provider=${tomlString(provider)}`,
    "-c",
    `model_providers.${provider}.name="Polza employee broker"`,
    "-c",
    `model_providers.${provider}.base_url="http://127.0.0.1:3456/v1"`,
    "-c",
    `model_providers.${provider}.wire_api="responses"`,
    "-c",
    `model_providers.${provider}.env_key="OPENAI_API_KEY"`,
    "-c",
    `model_providers.${provider}.requires_openai_auth=false`,
    "-c",
    `model_providers.${provider}.supports_websockets=false`,
    "-c",
    `model_providers.${provider}.request_max_retries=0`,
    "-c",
    `model_providers.${provider}.stream_max_retries=0`,
  ];
}
