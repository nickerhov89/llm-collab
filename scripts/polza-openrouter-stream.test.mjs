import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  acceptsLegacyExec,
  legacyExecResponseTransform,
} from "./polza-openrouter-stream.mjs";
const fixture = {
  input: [{ type: "additional_tools" }],
  tools: [
    {
      type: "function",
      name: "exec_command",
      parameters: {
        type: "object",
        properties: { cmd: { type: "string" } },
        required: ["cmd"],
      },
    },
  ],
};
async function convert(wire, sse = true) {
  let result = "";
  const bytes = Buffer.from(wire);
  const chunks = [];
  for (let i = 0; i < bytes.length; i += 3)
    chunks.push(bytes.subarray(i, i + 3));
  for await (const part of Readable.from(chunks).pipe(
    legacyExecResponseTransform(sse),
  ))
    result += part;
  return result;
}
test("legacy shell alias requires the live current function and legacy history", () => {
  assert.ok(acceptsLegacyExec(fixture));
  assert.equal(acceptsLegacyExec({ ...fixture, tools: [] }), false);
  assert.equal(acceptsLegacyExec({ ...fixture, input: [] }), false);
  assert.equal(
    acceptsLegacyExec({
      ...fixture,
      tools: [...fixture.tools, { name: "exec", type: "function" }],
    }),
    false,
  );
});
test("rewrites only schema-equivalent streamed exec calls, including terminal output", async () => {
  const item = {
    id: "fc_one",
    type: "function_call",
    call_id: "call_one",
    name: "exec",
    arguments: '{"cmd":"printf Привет"}',
  };
  const events = [
    { type: "response.created", response: { id: "resp" } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, arguments: "" },
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: "fc_one",
      delta: item.arguments,
    },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { output: [item] } },
  ];
  const wire =
    events
      .map((e) => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`)
      .join("") + "data: [DONE]\r\n\r\n";
  const actual = await convert(wire);
  const parsed = actual
    .split("\n")
    .filter((l) => l.startsWith("data: {"))
    .map((l) => JSON.parse(l.slice(6)));
  assert.equal(parsed[1].item.name, "exec_command");
  assert.equal(parsed[3].item.name, "exec_command");
  assert.equal(parsed[4].response.output[0].name, "exec_command");
  assert.equal(parsed[2].delta, item.arguments);
  assert.equal(parsed[4].response.output[0].call_id, item.call_id);
  assert.match(actual, /data: \[DONE\]/);
});
test("never aliases custom JavaScript, extra arguments or unrelated tools", async () => {
  for (const item of [
    { type: "custom_tool_call", name: "exec", input: "await arbitrary();" },
    {
      type: "function_call",
      name: "exec",
      arguments: '{"cmd":"printf OK","code":"anything"}',
    },
    {
      type: "function_call",
      name: "different",
      arguments: '{"cmd":"printf OK"}',
    },
  ]) {
    const value = { output: [item] };
    assert.deepEqual(
      JSON.parse(await convert(JSON.stringify(value), false)),
      value,
    );
  }
  const value = {
    output: [
      { type: "function_call", name: "exec", arguments: '{"cmd":"printf OK"}' },
    ],
  };
  assert.equal(
    JSON.parse(await convert(JSON.stringify(value), false)).output[0].name,
    "exec_command",
  );
});
