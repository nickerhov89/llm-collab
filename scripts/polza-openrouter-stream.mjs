import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";

// A legacy name is an alias only for the exact current shell-tool schema.
// Execution and all approval/sandbox checks still belong to the native CLI.
export function acceptsLegacyExec(input) {
  const hasExec = (tools) =>
    tools.some(
      (tool) =>
        tool.name === "exec" ||
        (Array.isArray(tool.tools) && hasExec(tool.tools)),
    );
  return Boolean(
    Array.isArray(input.tools) &&
      input.input?.some?.((item) => item?.type === "additional_tools") &&
      !hasExec(input.tools) &&
      input.tools.some(
        (tool) =>
          tool.type === "function" &&
          tool.name === "exec_command" &&
          tool.parameters?.properties?.cmd?.type === "string" &&
          Array.isArray(tool.parameters.required) &&
          tool.parameters.required.every((name) => name === "cmd"),
      ),
  );
}
function isEquivalentCall(item) {
  if (item?.type !== "function_call" || item.name !== "exec") return false;
  try {
    const args = JSON.parse(item.arguments);
    return (
      args &&
      !Array.isArray(args) &&
      Object.keys(args).length === 1 &&
      typeof args.cmd === "string"
    );
  } catch {
    return false;
  }
}
export function legacyExecResponseTransform(sse) {
  const decoder = new StringDecoder("utf8");
  const aliases = new Set();
  let pending = "",
    held = [],
    heldBytes = 0,
    disabled = false;
  const waiting = new Set();
  const limit = 1024 * 1024;
  function remember(event) {
    const item = event.item;
    if (
      event.type === "response.output_item.added" &&
      item?.type === "function_call" &&
      item.name === "exec"
    )
      waiting.add(item.id ?? event.output_index);
    if (event.type === "response.output_item.done") {
      waiting.delete(item?.id ?? event.output_index);
      if (isEquivalentCall(item)) aliases.add(item.call_id);
    }
    if (event.type === "response.completed") {
      for (const row of event.response?.output ?? [])
        if (isEquivalentCall(row)) aliases.add(row.call_id);
      waiting.clear();
    }
  }
  function renameItem(item) {
    if (
      item?.type === "function_call" &&
      item.name === "exec" &&
      aliases.has(item.call_id)
    )
      item.name = "exec_command";
  }
  function render(frame) {
    if (!frame.event) return frame.raw;
    const event = frame.event;
    renameItem(event.item);
    for (const row of event.response?.output ?? []) renameItem(row);
    return (
      frame.raw
        .split("\n")
        .filter((line) => !line.startsWith("data:"))
        .filter(Boolean)
        .join("\n") +
      "\ndata: " +
      JSON.stringify(event) +
      "\n\n"
    );
  }
  function frame(raw, output) {
    const data = raw
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      /* Keep comments, DONE and malformed frames verbatim. */
    }
    if (!disabled && event) remember(event);
    const row = { raw, event };
    if (!disabled && (held.length || waiting.size)) {
      held.push(row);
      heldBytes += Buffer.byteLength(raw);
      if (heldBytes > limit) {
        disabled = true;
        waiting.clear();
        for (const value of held) output.push(value.raw);
        held = [];
        heldBytes = 0;
      } else if (!waiting.size) {
        for (const value of held) output.push(render(value));
        held = [];
        heldBytes = 0;
      }
    } else output.push(render(row));
  }
  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        pending += decoder.write(chunk);
        if (!sse) {
          if (Buffer.byteLength(pending) > limit) {
            this.push(pending);
            pending = "";
            disabled = true;
          } else if (disabled) {
            this.push(pending);
            pending = "";
          }
        } else {
          pending = pending.replace(/\r\n/g, "\n");
          while (true) {
            const end = pending.indexOf("\n\n");
            if (end < 0) break;
            const raw = pending.slice(0, end + 2);
            pending = pending.slice(end + 2);
            frame(raw, this);
          }
          if (Buffer.byteLength(pending) > limit)
            throw Error("Upstream SSE frame exceeds bridge limit");
        }
        callback();
      } catch (error) {
        callback(error);
      }
    },
    flush(callback) {
      try {
        pending += decoder.end();
        if (sse) {
          for (const row of held) this.push(render(row));
          this.push(pending);
        } else if (pending) {
          let value;
          try {
            value = JSON.parse(pending);
          } catch {}
          if (!disabled && value) {
            for (const row of value.output ?? [])
              if (isEquivalentCall(row)) row.name = "exec_command";
            this.push(JSON.stringify(value));
          } else this.push(pending);
        }
        callback();
      } catch (error) {
        callback(error);
      }
    },
  });
}
