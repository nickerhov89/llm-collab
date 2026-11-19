import { readFile, writeFile, appendFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
const dir = process.env.POLZA_MODEL_AUDIT_DIR;
if (!dir)
  throw Error(
    "Set POLZA_MODEL_AUDIT_DIR from the completed text matrix; this makes paid synthetic API calls.",
  );
const models = JSON.parse(await readFile(join(dir, "catalog.json"), "utf8"));
const baseline = new Map(
  (await readFile(join(dir, "text-stream.ndjson"), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((x) => {
      const r = JSON.parse(x);
      return [r.model + "|" + r.api, r];
    }),
);
const safe = (s) =>
  String(s ?? "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 240);
function crc(b) {
  let c = 0xffffffff;
  for (const v of b) {
    c ^= v;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(t, b) {
  const type = Buffer.from(t),
    n = Buffer.alloc(4),
    c = Buffer.alloc(4);
  n.writeUInt32BE(b.length);
  c.writeUInt32BE(crc(Buffer.concat([type, b])));
  return Buffer.concat([n, type, b, c]);
}
const imageSize = 256;
const stride = imageSize * 3 + 1;
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(imageSize, 0);
ihdr.writeUInt32BE(imageSize, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc(imageSize * stride);
for (let y = 0; y < imageSize; y++)
  for (let x = 0; x < imageSize; x++) raw[y * stride + 1 + x * 3] = 255;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]).toString("base64");
const schema = {
  type: "object",
  properties: {
    value: { type: "string", enum: ["OK", "RED", "BLUE", "GREEN"] },
  },
  required: ["value"],
  additionalProperties: false,
};
async function request(api, input) {
  const r = await fetch("http://127.0.0.1:3451/v1/" + api, {
    method: "POST",
    headers: {
      authorization: "Bearer dummy",
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) {
    let b;
    try {
      b = await r.json();
    } catch {}
    return {
      ok: false,
      http: r.status,
      error: safe(b?.error?.message ?? b?.error ?? "HTTP error"),
    };
  }
  if (!r.headers.get("content-type")?.includes("text/event-stream"))
    return { ok: false, http: r.status, error: "Expected event-stream" };
  const reader = r.body.getReader(),
    decoder = new TextDecoder();
  let pending = "",
    text = "",
    complete = false,
    error = null,
    output = [],
    usage = null,
    size = 0;
  const calls = new Map();
  const thinking = new Map();
  const reasoningDetails = new Map();
  let reasoning = "";
  let stopReason;
  try {
    outer: while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 1024 * 1024) throw Error("Synthetic stream too large");
      pending = (
        pending + decoder.decode(part.value, { stream: true })
      ).replace(/\r\n/g, "\n");
      while (true) {
        const end = pending.indexOf("\n\n");
        if (end < 0) break;
        const block = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        if (data === "[DONE]") {
          complete = true;
          break outer;
        }
        let e;
        try {
          e = JSON.parse(data);
        } catch {
          error = "Invalid SSE JSON";
          break outer;
        }
        if (e.error || e.type === "response.failed" || e.type === "error") {
          error = safe(
            e.error?.message ?? e.response?.error?.message ?? e.type,
          );
          break outer;
        }
        if (e.type === "response.output_text.delta") text += e.delta ?? "";
        if (e.type === "response.completed") {
          output = e.response?.output ?? [];
          usage = e.response?.usage;
          complete = true;
          stopReason = e.response?.status;
          break outer;
        }
        if (
          e.type === "content_block_start" &&
          ["thinking", "redacted_thinking"].includes(e.content_block?.type)
        )
          thinking.set(e.index, structuredClone(e.content_block));
        if (
          e.type === "content_block_start" &&
          e.content_block?.type === "tool_use"
        )
          calls.set(e.index, {
            id: e.content_block.id,
            name: e.content_block.name,
            arguments: "",
            initial: e.content_block.input,
          });
        if (e.type === "content_block_delta") {
          const thought = thinking.get(e.index);
          if (thought && e.delta?.type === "thinking_delta")
            thought.thinking =
              (thought.thinking ?? "") + (e.delta.thinking ?? "");
          if (thought && e.delta?.type === "signature_delta")
            thought.signature =
              (thought.signature ?? "") + (e.delta.signature ?? "");
          if (e.delta?.type === "text_delta") text += e.delta.text ?? "";
          if (e.delta?.type === "input_json_delta") {
            const c = calls.get(e.index);
            if (c) c.arguments += e.delta.partial_json ?? "";
          }
        }
        if (e.type === "message_delta") {
          stopReason = e.delta?.stop_reason;
          usage = e.usage;
        }
        if (e.type === "message_stop") {
          complete = true;
          break outer;
        }
        for (const c of e.choices ?? []) {
          text += c.delta?.content ?? "";
          reasoning += c.delta?.reasoning ?? c.delta?.reasoning_content ?? "";
          for (const detail of c.delta?.reasoning_details ?? []) {
            const key = detail.index ?? detail.id ?? reasoningDetails.size;
            const previous = reasoningDetails.get(key);
            if (!previous) reasoningDetails.set(key, { ...detail });
            else {
              for (const field of ["text", "data", "signature"])
                if (typeof detail[field] === "string")
                  previous[field] = (previous[field] ?? "") + detail[field];
            }
          }
          if (c.finish_reason) stopReason = c.finish_reason;
          for (const t of c.delta?.tool_calls ?? []) {
            let item = calls.get(t.index);
            if (!item) {
              item = { id: "", name: "", arguments: "" };
              calls.set(t.index, item);
            }
            if (t.id) item.id = t.id;
            if (t.function?.name) item.name += t.function.name;
            item.arguments += t.function?.arguments ?? "";
          }
        }
        usage = e.usage ?? usage;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const tool =
    api === "responses"
      ? output.find((x) => x.type === "function_call")
      : [...calls.values()][0];
  if (tool && api === "messages" && !tool.arguments)
    tool.arguments = JSON.stringify(tool.initial ?? {});
  return {
    ok: complete && !error,
    http: r.status,
    error,
    complete,
    text,
    tool,
    output,
    usage,
    stopReason,
    thinking: [...thinking.values()],
    reasoning,
    reasoningDetails: [...reasoningDetails.values()],
  };
}
function first(model, api, image) {
  const prompt = image
    ? "Look at the image. Call smoke_echo once with its dominant color, uppercase RED, BLUE or GREEN. After the tool result reply exactly OK."
    : "Call smoke_echo once with value OK. After the tool result reply exactly OK.";
  const input = { model, stream: true };
  if (api === "messages") {
    input.max_tokens = 512;
    input.tools = [
      {
        name: "smoke_echo",
        description: "Echo a test value. No side effects.",
        input_schema: schema,
      },
    ];
    input.messages = [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...(image
            ? [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: png,
                  },
                },
              ]
            : []),
        ],
      },
    ];
  } else if (api === "chat/completions") {
    input.max_tokens = 512;
    input.tools = [
      {
        type: "function",
        function: {
          name: "smoke_echo",
          description: "Echo a test value. No side effects.",
          parameters: schema,
        },
      },
    ];
    input.messages = [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...(image
            ? [
                {
                  type: "image_url",
                  image_url: { url: "data:image/png;base64," + png },
                },
              ]
            : []),
        ],
      },
    ];
  } else {
    input.max_output_tokens = 512;
    input.tools = [
      {
        type: "function",
        name: "smoke_echo",
        description: "Echo a test value. No side effects.",
        parameters: schema,
      },
    ];
    input.input = [
      {
        type: "additional_tools",
        id: "audit_history",
        role: "developer",
        tools: [{ type: "namespace", name: "audit_old", tools: [] }],
      },
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "reasoning_text", text: "Previous synthetic check only." },
        ],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          ...(image
            ? [
                {
                  type: "input_image",
                  image_url: "data:image/png;base64," + png,
                },
              ]
            : []),
        ],
      },
    ];
  }
  return input;
}
async function probe(t) {
  const input = first(t.model, t.api, t.image),
    one = await request(t.api, input);
  const result = {
    http: one.http,
    stream: one.ok,
    image: t.image,
    cost: one.usage?.cost ?? 0,
  };
  if (!one.ok)
    return { ...result, ok: false, stage: "tool-request", error: one.error };
  if (!one.tool)
    return {
      ...result,
      ok: false,
      stage: "tool-request",
      error: "Expected tool call missing",
      stopReason: one.stopReason,
    };
  const call = one.tool;
  let args;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    return {
      ...result,
      ok: false,
      stage: "tool-arguments",
      error: "Invalid tool arguments JSON",
    };
  }
  result.toolName = call.name;
  result.argument = args.value;
  result.argumentMatch =
    String(args.value).toUpperCase() === (t.image ? "RED" : "OK");
  if (call.name !== "smoke_echo")
    return {
      ...result,
      ok: false,
      stage: "tool-name",
      error: "Unexpected tool name",
    };
  if (t.api === "messages")
    input.messages.push(
      {
        role: "assistant",
        content: [
          ...one.thinking,
          { type: "tool_use", id: call.id, name: call.name, input: args },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: call.id,
            content: String(args.value),
          },
        ],
      },
    );
  else if (t.api === "chat/completions")
    input.messages.push(
      {
        role: "assistant",
        content: null,
        ...(one.reasoningDetails.length
          ? { reasoning_details: one.reasoningDetails }
          : one.reasoning
            ? { reasoning: one.reasoning, reasoning_content: one.reasoning }
            : {}),
        tool_calls: [
          {
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          },
        ],
      },
      { role: "tool", tool_call_id: call.id, content: String(args.value) },
    );
  else
    input.input.push(...one.output, {
      type: "function_call_output",
      call_id: call.call_id,
      output: String(args.value),
    });
  const two = await request(t.api, input);
  result.cost += two.usage?.cost ?? 0;
  result.continuationHttp = two.http;
  result.continuation = two.ok && two.text.includes("OK");
  return {
    ...result,
    ok: result.argumentMatch && result.continuation,
    stage: two.ok ? "complete" : "continuation",
    error:
      two.error ??
      (!result.argumentMatch
        ? "Argument/image mismatch"
        : !result.continuation
          ? "Expected OK reply missing"
          : null),
    stopReason: two.stopReason,
  };
}
const tasks = [];
for (const m of models)
  for (const api of ["responses", "messages", "chat/completions"])
    if (!m.endpoints || m.endpoints.includes("/api/v1/" + api))
      tasks.push({
        model: m.id,
        api,
        image: m.architecture?.input_modalities?.includes("image") ?? false,
      });
const file = join(dir, "tools-image-stream.ndjson"),
  seen = new Set();
let done = 0,
  pass = 0,
  failed = 0,
  skipped = 0,
  index = 0;
try {
  for (const line of (await readFile(file, "utf8")).trim().split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line);
    seen.add(r.model + "|" + r.api);
    done++;
    if (r.skipped) skipped++;
    else if (r.ok) pass++;
    else failed++;
  }
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
let writes = Promise.resolve();
const active = new Map();
async function progress() {
  await writeFile(
    join(dir, "tools-progress.next.json"),
    JSON.stringify({
      phase: "tools-and-images",
      total: tasks.length,
      done,
      pass,
      failed,
      skipped,
      active: [...active.values()],
      updatedAt: new Date().toISOString(),
    }),
    { mode: 0o600 },
  );
  await rename(
    join(dir, "tools-progress.next.json"),
    join(dir, "tools-progress.json"),
  );
}
const timer = setInterval(() => {
  writes = writes.then(progress);
}, 10000);
timer.unref();
await progress();
await Promise.all(
  Array.from({ length: 3 }, async (_, worker) => {
    while (index < tasks.length) {
      const t = tasks[index++];
      if (seen.has(t.model + "|" + t.api)) continue;
      active.set(worker, t);
      const b = baseline.get(t.model + "|" + t.api);
      let row;
      if ([403, 404].includes(b?.http)) {
        row = {
          ...t,
          ok: false,
          skipped: true,
          http: b.http,
          stage: "baseline-unavailable",
          error: b.error,
        };
        skipped++;
      } else {
        const start = Date.now();
        try {
          row = { ...t, ...(await probe(t)), ms: Date.now() - start };
        } catch (e) {
          row = {
            ...t,
            ok: false,
            error: safe(
              e.name === "TimeoutError" ? "Request timeout" : e.message,
            ),
            ms: Date.now() - start,
          };
        }
        row.ok ? pass++ : failed++;
      }
      done++;
      active.delete(worker);
      writes = writes.then(async () => {
        await appendFile(
          file,
          JSON.stringify({ ...row, at: new Date().toISOString() }) + "\n",
          { mode: 0o600 },
        );
        await progress();
      });
      await writes;
    }
  }),
);
clearInterval(timer);
await writes;
await progress();
console.log(
  JSON.stringify({ done, pass, failed, skipped, total: tasks.length }),
);
