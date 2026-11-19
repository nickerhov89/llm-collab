import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GatewayModelEffort } from "@yep-anywhere/shared";
import { CODEX_GATEWAY_PROMPT } from "./codex-gateway-prompt.js";

/** A launch-scoped native catalog, never a rewrite of CLI config or history. */
export async function prepareCodexGatewayCatalog(
  url: string,
  modelId: string,
  effort?: GatewayModelEffort,
  directory = join(
    process.env.YEP_DATA_DIR ?? join(homedir(), ".yep-anywhere"),
    "gateway-models",
  ),
  signal?: AbortSignal,
): Promise<{ path: string; dispose: () => Promise<void> }> {
  const response = await fetch(`${url}/v1/models`, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Gateway model metadata unavailable");
  const catalog = (await response.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      max_model_len?: number;
      input_modalities?: string[];
    }>;
  };
  const row = catalog.data?.find((item) => item.id === modelId);
  if (!row)
    throw new Error("Selected model is absent from the gateway catalog");
  const context =
    Number.isSafeInteger(row.max_model_len) && (row.max_model_len ?? 0) > 0
      ? row.max_model_len
      : null;
  const metadata = {
    slug: modelId,
    display_name: row.name ?? modelId,
    description: null,
    default_reasoning_level: effort?.defaultLevel ?? effort?.levels[0] ?? null,
    supported_reasoning_levels:
      effort?.levels.map((level) => ({ effort: level, description: level })) ??
      [],
    shell_type: "unified_exec",
    visibility: "list",
    supported_in_api: true,
    priority: 1,
    availability_nux: null,
    upgrade: null,
    model_messages: { instructions_template: CODEX_GATEWAY_PROMPT },
    include_skills_usage_instructions: false,
    include_plugin_usage_instructions: false,
    include_apps_usage_instructions: false,
    supports_reasoning_summary_parameter: false,
    default_reasoning_summary: "none",
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: null,
    web_search_tool_type: "text",
    truncation_policy: { mode: "bytes", limit: 10000 },
    supports_image_detail_original: false,
    context_window: context,
    max_context_window: context,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: row.input_modalities?.includes("image")
      ? ["text", "image"]
      : ["text"],
    supports_search_tool: false,
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(directory, "launch-"));
  try {
    const path = join(temporary, "models.json");
    await writeFile(path, JSON.stringify({ models: [metadata] }), {
      mode: 0o600,
    });
    return {
      path,
      dispose: () => rm(temporary, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
