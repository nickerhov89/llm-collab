import {
  readFile,
  writeFile,
  mkdir,
  appendFile,
  rename,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
const dir = process.env.POLZA_MODEL_AUDIT_DIR;
if (!dir)
  throw Error(
    "Set POLZA_MODEL_AUDIT_DIR to a private audit directory; this makes paid synthetic API calls.",
  );
await mkdir(dir, { recursive: true, mode: 0o700 });
const key = (
  await readFile(join(homedir(), ".config/polza/openrouter-cowork.key"), "utf8")
).trim();
const headers = { authorization: `Bearer ${key}` };
const catalog = await (
  await fetch("https://openrouter.ai/api/v1/models/user", {
    headers,
    signal: AbortSignal.timeout(20000),
  })
).json();
const exposed = await (await fetch("http://127.0.0.1:3451/v1/models")).json();
const byId = new Map(catalog.data.map((m) => [m.id, m]));
const models = exposed.data.map((m) => ({ ...m, ...byId.get(m.id) }));
models.sort((a, b) =>
  a.id === "qwen/qwen3-vl-30b-a3b-instruct"
    ? -1
    : b.id === "qwen/qwen3-vl-30b-a3b-instruct"
      ? 1
      : a.id.localeCompare(b.id),
);
await writeFile(join(dir, "catalog.json"), JSON.stringify(models), {
  mode: 0o600,
});
const tasks = [];
for (const m of models)
  for (const api of ["responses", "messages", "chat/completions"]) {
    const path = "/v1/" + api;
    if (!m.endpoints || m.endpoints.includes("/api" + path))
      tasks.push({ model: m.id, api });
  }
const file = join(dir, "text-stream.ndjson");
const seen = new Set();
try {
  for (const line of (await readFile(file, "utf8")).trim().split("\n")) {
    if (line) {
      const x = JSON.parse(line);
      seen.add(x.model + "|" + x.api);
    }
  }
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
let done = seen.size,
  pass = 0,
  failed = 0,
  index = 0;
if (seen.size) {
  for (const line of (await readFile(file, "utf8")).trim().split("\n")) {
    if (line) {
      const r = JSON.parse(line);
      r.ok ? pass++ : failed++;
    }
  }
}
const active = new Map();
let writes = Promise.resolve();
const clean = (s) =>
  String(s ?? "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .slice(0, 240);
async function stream(api, input) {
  const started = Date.now();
  const events = [];
  let text = "",
    complete = false,
    error = null,
    usage;
  const r = await fetch("http://127.0.0.1:3451/v1/" + api, {
    method: "POST",
    headers: {
      authorization: "Bearer dummy",
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) {
    let body;
    try {
      body = await r.json();
    } catch {}
    return {
      ok: false,
      http: r.status,
      error: clean(body?.error?.message ?? body?.error ?? "HTTP error"),
      ms: Date.now() - started,
    };
  }
  if (!r.headers.get("content-type")?.includes("text/event-stream")) {
    return {
      ok: false,
      http: r.status,
      error: "Expected event-stream",
      ms: Date.now() - started,
    };
  }
  const reader = r.body.getReader();
  let pending = "",
    size = 0;
  const decoder = new TextDecoder();
  try {
    outer: while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 512000) throw Error("Synthetic output exceeded 512KiB");
      pending += decoder
        .decode(next.value, { stream: true })
        .replace(/\r\n/g, "\n");
      while (true) {
        const cut = pending.indexOf("\n\n");
        if (cut < 0) break;
        const block = pending.slice(0, cut);
        pending = pending.slice(cut + 2);
        const data = block
          .split("\n")
          .filter((x) => x.startsWith("data:"))
          .map((x) => x.slice(5).trimStart())
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
        const type = e.type ?? (e.choices ? "chat.chunk" : "unknown");
        if (!events.includes(type) && events.length < 24) events.push(type);
        if (type === "error" || type === "response.failed" || e.error) {
          error = clean(e.error?.message ?? e.response?.error?.message ?? type);
          break outer;
        }
        if (type === "response.output_text.delta") text += e.delta ?? "";
        if (type === "content_block_delta" && e.delta?.type === "text_delta")
          text += e.delta.text ?? "";
        for (const choice of e.choices ?? [])
          text += choice.delta?.content ?? "";
        usage = e.usage ?? e.response?.usage ?? usage;
        if (type === "response.completed" || type === "message_stop") {
          complete = true;
          break outer;
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return {
    ok: complete && !error && text.includes("OK"),
    http: r.status,
    complete,
    chars: text.length,
    events,
    error:
      error ??
      (!complete
        ? "Stream ended before completion"
        : !text.includes("OK")
          ? "Expected OK reply missing"
          : null),
    usage,
    ms: Date.now() - started,
  };
}
async function probe(t) {
  const input = { model: t.model, stream: true };
  if (t.api === "responses") {
    input.input = [{ role: "user", content: "Reply exactly OK." }];
    input.max_output_tokens = 128;
  } else {
    input.messages = [{ role: "user", content: "Reply exactly OK." }];
    input.max_tokens = 128;
  }
  return stream(t.api, input);
}
async function progress() {
  const value = {
    phase: "text-stream",
    total: tasks.length,
    done,
    pass,
    failed,
    active: [...active.values()],
    updatedAt: new Date().toISOString(),
  };
  await writeFile(join(dir, "progress.next.json"), JSON.stringify(value), {
    mode: 0o600,
  });
  await rename(join(dir, "progress.next.json"), join(dir, "progress.json"));
}
const ticker = setInterval(() => {
  writes = writes.then(progress);
}, 10000);
ticker.unref();
await progress();
await Promise.all(
  Array.from({ length: 3 }, async (_, worker) => {
    while (index < tasks.length) {
      const t = tasks[index++];
      if (seen.has(t.model + "|" + t.api)) continue;
      active.set(worker, t);
      let result;
      try {
        result = await probe(t);
      } catch (e) {
        result = {
          ok: false,
          error: clean(
            e.name === "TimeoutError" ? "Request timeout" : e.message,
          ),
        };
      }
      const row = { ...t, ...result, at: new Date().toISOString() };
      done++;
      result.ok ? pass++ : failed++;
      active.delete(worker);
      writes = writes.then(async () => {
        await appendFile(file, JSON.stringify(row) + "\n", { mode: 0o600 });
        await progress();
      });
      await writes;
    }
  }),
);
clearInterval(ticker);
await writes;
await progress();
console.log(JSON.stringify({ done, pass, failed, total: tasks.length }));
