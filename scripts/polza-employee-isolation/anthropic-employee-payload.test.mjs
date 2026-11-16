import { test } from "node:test";
import assert from "node:assert/strict";
import { materializeEmployeeTools } from "./anthropic-employee-payload.mjs";

test("materializes chronological reference and inline tool changes without changing history", () => {
  const tool = (name, extra = {}) => ({
    name,
    input_schema: { type: "object" },
    ...extra,
  });
  const delta = (type, name) => ({
    type,
    tool: { type: "tool_reference", name },
  });
  const body = {
    tools: [tool("old"), tool("lazy", { defer_loading: true })],
    messages: [
      { role: "user", content: "Keep this request" },
      {
        role: "system",
        content: [
          { type: "text", text: "Keep this update" },
          delta("tool_removal", "old"),
          delta("tool_addition", "lazy"),
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "past-call", name: "old", input: {} },
        ],
      },
      {
        role: "system",
        content: [
          delta("tool_removal", "lazy"),
          {
            type: "tool_addition",
            tool: { type: "tool_definition", definition: tool("inline") },
          },
        ],
      },
      { role: "system", content: [delta("tool_addition", "old")] },
    ],
  };
  const before = JSON.stringify(body);
  const out = materializeEmployeeTools(body);
  assert.deepEqual(
    out.tools.map((t) => t.name),
    ["inline", "old"],
  );
  assert.equal(out.messages.length, 3);
  assert.deepEqual(out.messages[1].content, [
    { type: "text", text: "Keep this update" },
  ]);
  assert.deepEqual(out.messages[2], body.messages[2]);
  assert.equal(JSON.stringify(body), before);
});

test("deferred tools require an addition and undeclared/hosted references fail closed", () => {
  const out = materializeEmployeeTools({
    tools: [
      { name: "lazy", defer_loading: true, input_schema: { type: "object" } },
    ],
    messages: [],
  });
  assert.deepEqual(out.tools, []);
  for (const reference of [
    { type: "tool_reference", name: "missing" },
    { type: "mcp_toolset_reference", server_name: "remote" },
  ]) {
    assert.throws(() =>
      materializeEmployeeTools({
        messages: [
          {
            role: "system",
            content: [{ type: "tool_addition", tool: reference }],
          },
        ],
      }),
    );
  }
});
