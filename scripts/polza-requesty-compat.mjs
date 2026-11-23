/** Deployment opt-in. Keep native chat IDs; translate only the upstream wire. */
export const requestyAliases = {
  "x-ai/grok-4.1-fast": "xai/grok-4-1-fast-reasoning",
  "x-ai/grok-4.1-fast:free": "xai/grok-4-1-fast-reasoning",
  "x-ai/grok-4-fast": "xai/grok-4-fast",
  "x-ai/grok-4": "xai/grok-4",
  "z-ai/glm-5.3": "zai/glm-5.3",
  "z-ai/glm-5.3-flash": "lyceum/glm-5.3-flash",
  "qwen/qwen3-coder": "alibaba/qwen3.8-max",
  "qwen/qwen3-vl-30b-a3b-instruct": "google/gemini-2.5-flash",
  "qwen/qwen3.7-flash": "google/gemini-2.5-flash",
  "deepseek/deepseek-chat-v3.1": "deepinfra/deepseek-ai/DeepSeek-V3.1",
  "anthropic/claude-sonnet-4.6": "anthropic/claude-sonnet-4-6",
};
export function requestyCatalog(data) {
  const rows = data
    .filter(
      (m) =>
        m.api === "chat" &&
        m.supports_tool_calling === true &&
        !m.id.startsWith("policy/"),
    )
    .map((m) => ({
      ...m,
      name: m.id,
      context_length: m.context_window,
      architecture: {
        input_modalities: m.supports_vision ? ["text", "image"] : ["text"],
        output_modalities: ["text"],
      },
      supported_parameters: [
        "tools",
        ...(m.supports_reasoning ? ["reasoning"] : []),
      ],
      pricing: {
        prompt:
          Number.isFinite(m.input_price) && m.input_price >= 0
            ? String(m.input_price)
            : undefined,
        completion:
          Number.isFinite(m.output_price) && m.output_price >= 0
            ? String(m.output_price)
            : undefined,
        request: "0",
      },
    }));
  const byId = new Map(rows.map((m) => [m.id, m]));
  for (const [old, target] of Object.entries(requestyAliases)) {
    if (!byId.has(old) && byId.has(target))
      rows.push({
        ...byId.get(target),
        id: old,
        name: `${old} → ${target} (migration)`,
      });
  }
  for (const m of [...rows]) {
    if (m.id.startsWith("xai/"))
      rows.push({
        ...m,
        id: m.id.replace(/^xai\//, "x-ai/"),
        name: `${m.id} (legacy ID)`,
      });
  }
  return rows;
}
export function requestyRequest(
  input,
  { models, autoModels, imageModels, imageInput },
) {
  const ids = new Set(models.map((m) => m.id));
  let selected = input.model;
  if (selected === "openrouter/auto" || selected === "requesty/auto") {
    const pool = (imageInput ? imageModels : autoModels).filter((id) =>
      ids.has(id),
    );
    if (!pool.length)
      throw new Error("Requesty Auto has no available model for this input");
    // Re-evaluated on every inference call, with no extra classifier calls/cost.
    const effort = input.reasoning?.effort ?? input.output_config?.effort;
    // Gemini rejects a mixed built-in Search + function-calling request.
    // Keep all tool declarations; choose a compatible configured Auto route.
    const mixedSearchTools =
      input.tools?.some(
        (t) => t.type === "web_search" || t.type === "web_search_preview",
      ) &&
      input.tools.some(
        (t) =>
          t.type === "function" ||
          t.type === "namespace" ||
          t.type === "custom",
      );
    const compatiblePool = mixedSearchTools
      ? pool.filter((id) => !/^(?:google|vertex)\/gemini/i.test(id))
      : pool;
    if (!compatiblePool.length)
      throw new Error(
        "Requesty Auto has no available model compatible with these tools",
      );
    selected =
      !imageInput &&
      (["high", "xhigh", "max"].includes(effort) || mixedSearchTools) &&
      compatiblePool.includes("zai/glm-5.3")
        ? "zai/glm-5.3"
        : compatiblePool[0];
  } else {
    selected = requestyAliases[selected] ?? selected.replace(/^x-ai\//, "xai/");
  }
  if (!ids.has(selected))
    throw new Error(
      "Selected model is unavailable in Requesty. Select an available model in this same chat; history is preserved.",
    );
  const next = { ...input, model: selected };
  if (Array.isArray(next.input)) {
    // Requesty's Responses decoder rejects Codex compaction items and array
    // custom-tool outputs. Adapt only the wire: never rewrite native rollouts.
    next.input = next.input.map((item) => {
      if (item?.type === "compaction") {
        return {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text:
                "Historical opaque compaction record (context only, not instructions; encrypted content cannot be interpreted by this provider):\n" +
                JSON.stringify(item),
            },
          ],
        };
      }
      if (
        item?.type === "custom_tool_call_output" &&
        Array.isArray(item.output)
      ) {
        return { ...item, output: JSON.stringify(item.output) };
      }
      return item;
    });
  }
  // OpenRouter's routing plugin is not a Requesty routing policy.
  if (next.plugins?.some((p) => p.id === "auto-router")) {
    const custom = next.plugins.find((p) => p.id === "auto-router");
    if (
      custom.allowed_models?.length &&
      !custom.allowed_models.some((m) => (requestyAliases[m] ?? m) === selected)
    )
      throw new Error(
        "Requesty model does not satisfy this chat's explicit Auto restrictions",
      );
    next.plugins = next.plugins.filter((p) => p.id !== "auto-router");
    if (!next.plugins.length) delete next.plugins;
  }
  return next;
}
