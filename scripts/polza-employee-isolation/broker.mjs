import http from "node:http";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { once } from "node:events";
const cfg = JSON.parse(await readFile(process.env.BROKER_CONFIG, "utf8"));
const ledgerFile = process.env.BROKER_LEDGER;
await mkdir(new URL(".", `file://${ledgerFile}`).pathname, {
  recursive: true,
  mode: 0o700,
});
let ledger;
try {
  ledger = JSON.parse(await readFile(ledgerFile, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  ledger = {};
}
const active = new Set();
let flush = Promise.resolve();
const hash = (x) => createHash("sha256").update(x).digest("hex");
const accounts = new Map(
  Object.entries(cfg.accounts).map(([name, p]) => [
    hash(p.token),
    { name, ...p },
  ]),
);
function persist() {
  const snapshot = JSON.stringify(ledger);
  flush = flush.then(async () => {
    await writeFile(ledgerFile + ".tmp", snapshot, { mode: 0o600 });
    await rename(ledgerFile + ".tmp", ledgerFile);
  });
  return flush;
}
function fail(res, status, error) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify({ error: { message: error } }));
}
const server = http.createServer(async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
  const account = accounts.get(hash(token));
  if (!account) return fail(res, 401, "Employee capability required");
  if (req.method === "GET" && req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: [{ id: cfg.model, object: "model", owned_by: "polza" }],
      }),
    );
    return;
  }
  if (req.method !== "POST" || req.url !== "/v1/responses")
    return fail(res, 403, "Endpoint unavailable");
  if (active.has(account.name))
    return fail(res, 429, "One model request at a time");
  active.add(account.name);
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  const key = new Date().toISOString().slice(0, 10) + ":" + account.name;
  const reserve = 0.1;
  let admitted = false;
  let spent = reserve;
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 100000) {
        fail(res, 413, "Request exceeds employee context limit");
        return;
      }
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString());
    if (
      input.model !== cfg.model ||
      input.previous_response_id ||
      input.background ||
      input.store ||
      input.service_tier === "priority"
    )
      return fail(res, 403, "Model or state option unavailable");
    const allowed = [
      "model",
      "input",
      "instructions",
      "tools",
      "tool_choice",
      "parallel_tool_calls",
      "stream",
      "temperature",
      "top_p",
      "text",
      "reasoning",
      "include",
      "truncation",
      "prompt_cache_key",
    ];
    const body = Object.fromEntries(
      allowed.filter((k) => k in input).map((k) => [k, input[k]]),
    );
    const safeTool = (t) =>
      ["function", "custom"].includes(t.type) ||
      (t.type === "namespace" &&
        Array.isArray(t.tools) &&
        t.tools.every(safeTool));
    if (Array.isArray(body.tools))
      body.tools = body.tools.filter(
        (t) => !["web_search", "web_search_preview"].includes(t.type),
      );
    if (body.tools?.some((t) => !safeTool(t)))
      return fail(res, 403, "Hosted tools unavailable");
    body.max_output_tokens = 2048;
    body.store = false;
    const entry = ledger[key] ?? { spent: 0, requests: 0 };
    if (entry.spent + reserve > account.dailyLimit || entry.requests >= 300)
      return fail(res, 429, "Employee daily model limit reached");
    entry.spent += reserve;
    entry.requests++;
    ledger[key] = entry;
    // Persist reservation before spending; an unknown outcome retains its reservation.
    await persist();
    admitted = true;
    const upstream = await fetch("https://openrouter.ai/api/v1/responses", {
      method: "POST",
      headers: {
        authorization: "Bearer " + cfg.upstreamKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
    });
    if (!upstream.ok) {
      return fail(res, 502, "Model provider rejected the request");
    }
    res.writeHead(200, {
      "content-type":
        upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-store",
    });
    let tail = "";
    let completed = false;
    for await (const chunk of upstream.body) {
      tail += Buffer.from(chunk).toString();
      if (tail.length > 2000000) throw new Error("Response too large");
      if (!res.write(Buffer.from(chunk)))
        await once(res, "drain", { signal: controller.signal });
    }
    try {
      let usage;
      if (body.stream) {
        for (const line of tail.split("\n"))
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "response.completed") {
                usage = event.response?.usage;
                completed = true;
              }
            } catch {}
          }
      } else {
        usage = JSON.parse(tail).usage;
        completed = true;
      }
      if (
        completed &&
        Number.isFinite(usage?.cost) &&
        usage.cost >= 0 &&
        usage.cost <= reserve
      )
        spent = usage.cost;
    } catch {}
    res.end();
  } catch {
    if (!res.headersSent) fail(res, 502, "Employee model request failed");
    else res.destroy();
  } finally {
    if (admitted) {
      ledger[key].spent += spent - reserve;
      await persist().catch(() => {
        server.close();
        process.exitCode = 1;
      });
    }
    active.delete(account.name);
  }
});
server.headersTimeout = 10000;
server.requestTimeout = 130000;
server.maxConnections = 32;
server.on("upgrade", (_req, socket) =>
  socket.end(
    "HTTP/1.1 426 Upgrade Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
  ),
);
server.listen(3456, "127.0.0.1");
