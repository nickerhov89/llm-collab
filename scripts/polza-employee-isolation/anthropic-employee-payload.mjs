/** Materialize the current tool set for models without Anthropic tool deltas. */
export function materializeEmployeeTools(body) {
  const definitions = new Map();
  const active = new Set();
  for (const tool of body.tools ?? []) {
    definitions.set(tool.name, tool);
    if (!tool.defer_loading) active.add(tool.name);
  }
  const messages = [];
  for (const message of body.messages ?? []) {
    if (message.role !== "system" || !Array.isArray(message.content)) {
      messages.push(message);
      continue;
    }
    const content = [];
    for (const block of message.content) {
      if (!["tool_addition", "tool_removal"].includes(block.type)) {
        content.push(block);
        continue;
      }
      const tool =
        block.tool?.type === "tool_definition"
          ? block.tool.definition
          : block.tool;
      if (typeof tool?.name !== "string") {
        throw new Error("Unsupported employee tool reference");
      }
      if (block.type === "tool_removal") {
        active.delete(tool.name);
      } else {
        if (tool.input_schema) definitions.set(tool.name, tool);
        else if (
          tool.type !== "tool_reference" ||
          !definitions.has(tool.name)
        ) {
          throw new Error("Unresolved employee tool reference");
        }
        active.add(tool.name);
      }
    }
    if (content.length) messages.push({ ...message, content });
  }
  const tools = [...active].map((name) => {
    const { defer_loading: _deferred, ...tool } = definitions.get(name);
    return tool;
  });
  return {
    ...body,
    messages,
    ...(body.tools || tools.length ? { tools } : {}),
  };
}
