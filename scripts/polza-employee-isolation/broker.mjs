import http from "node:http";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { EmployeeAdmission, AdmissionError } from "./employee-admission.mjs";
import { RouterUsage } from "./router-usage.mjs";
import { ResponseAccounting } from "./response-accounting.mjs";
import { materializeEmployeeTools } from "./anthropic-employee-payload.mjs";
const cfg = JSON.parse(await readFile(process.env.BROKER_CONFIG, "utf8"));
const routerUsage = new RouterUsage(cfg.upstreamKey);
const ownerRouterUsage = cfg.ownerUsageKey
  ? new RouterUsage(cfg.ownerUsageKey)
  : routerUsage;
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

let models = [],
  modelsAt = 0,
  modelRefresh;
async function catalog() {
  if (models.length && Date.now() - modelsAt < 300000) return models;
  if (!modelRefresh)
    modelRefresh = (async () => {
      const r = await fetch("https://openrouter.ai/api/v1/models", {
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) throw new Error("Model catalog unavailable");
      const d = await r.json();
      const next = d.data.filter(
        (m) =>
          typeof m.id === "string" &&
          !m.id.endsWith(":batch") &&
          m.architecture?.output_modalities?.includes("text"),
      );
      if (!next.length) throw new Error("Empty model catalog");
      if (!next.some((m) => m.id === "openrouter/auto"))
        next.unshift({
          id: "openrouter/auto",
          name: "OpenRouter Auto",
          context_length: 262144,
        });
      models = next;
      modelsAt = Date.now();
      return models;
    })().finally(() => {
      modelRefresh = undefined;
    });
  try {
    return await modelRefresh;
  } catch (e) {
    if (models.length) return models;
    throw e;
  }
}
// Inline image bytes are transport data, not text-context tokens. One native
// PNG plus history already exceeds 2 MiB. Keep per-request and aggregate bounds
// independent; all retained request buffers stay charged until settlement.
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_INFLIGHT_BYTES = 24 * 1024 * 1024;
const admission = new EmployeeAdmission(Object.keys(cfg.accounts), {
  maxBytes: MAX_INFLIGHT_BYTES,
});
const MAX_OUTPUT_TOKENS = 8192;
let flush = Promise.resolve();
const hash = (x) => createHash("sha256").update(x).digest("hex");
const accounts = new Map(
  Object.entries(cfg.accounts).map(([name, p]) => [
    hash(p.token),
    { name, ...p },
  ]),
);
const pendingBudgets = new Map();
function persist() {
  const snapshot = JSON.stringify(ledger);
  flush = flush.then(async () => {
    await writeFile(ledgerFile + ".tmp", snapshot, { mode: 0o600 });
    await rename(ledgerFile + ".tmp", ledgerFile);
  });
  return flush;
}
function fail(res, status, error) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify({ error: { message: error } }));
}
const server = http.createServer(async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
  const account = accounts.get(hash(token));
  const statusOnly = cfg.statusToken && hash(token) === hash(cfg.statusToken);
  if (
    !account &&
    !(statusOnly && req.method === "GET" && req.url === "/v1/status")
  )
    return fail(res, 401, "Employee capability required");
  if (req.method === "GET" && req.url === "/v1/status") {
    const day = new Date().toISOString().slice(0, 10);
    const usage = ledger[day + ":" + account?.name] ?? {
      spent: 0,
      requests: 0,
    };
    const billing = await (account ? routerUsage : ownerRouterUsage).get();
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    return res.end(
      JSON.stringify({
        account: account?.name ?? null,
        billing,
        active: account
          ? admission.running.get(account.name)
          : admission.active,
        queued: admission.queue.filter(
          (entry) => !account || entry.account === account.name,
        ).length,
        concurrency: admission.perAccount,
        queueCapacity: admission.maxPending,
        maxQueueWaitMs: admission.maxWaitMs,
        dailyBudget: account?.dailyLimit ?? null,
        spentOrReservedToday: usage.spent,
        confirmedSinceTracking: usage.confirmed ?? 0,
        unverifiedReserved: usage.unverified ?? 0,
        legacyUpperBound: usage.legacyUpperBound ?? usage.spent,
        inflightReserved: [...pendingBudgets.values()]
          .filter((entry) => entry.key === day + ":" + account?.name)
          .reduce((total, entry) => total + entry.reserve, 0),
        transports: usage.transports ?? null,
        requestsToday: usage.requests,
        maxRequests: account?.maxRequests ?? 3000,
      }),
    );
  }
  if (req.method === "GET" && req.url === "/v1/models") {
    let rows;
    try {
      rows = await catalog();
    } catch {
      return fail(res, 503, "Model catalog unavailable");
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: rows.map((m) => ({
          id: m.id,
          name: m.name,
          object: "model",
          owned_by: m.id.split("/")[0],
          context_length: m.context_length,
          supported_parameters: m.supported_parameters,
        })),
      }),
    );
    return;
  }
  const anthropic = req.url?.split("?")[0] === "/v1/messages";
  // Both native CLIs retry 429/5xx and may hide the broker's reason.
  // Scoped denials are terminal, retaining their actionable message.
  const reject = (status, error) => {
    console.warn(
      JSON.stringify({
        event: "employee_model_rejected",
        account: account.name,
        status,
        error,
      }),
    );
    return fail(res, status === 429 || status === 502 ? 424 : status, error);
  };
  if (req.method !== "POST" || (!anthropic && req.url !== "/v1/responses"))
    return fail(res, 403, "Endpoint unavailable");
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  req.on("aborted", () => controller.abort());
  let key;
  let reserve = 0;
  let admitted = false;
  let spent = reserve;
  let costKnown = false;
  let transport;
  let accounting;
  const budgetId = Symbol();
  let releaseAdmission;
  const settle = async () => {
    try {
      if (admitted) {
        admitted = false;
        if (!costKnown && accounting) {
          const cost =
            accounting.cost ??
            (await routerUsage.generation(accounting.generationId));
          if (cost !== null) {
            spent = cost;
            costKnown = true;
          }
        }
        ledger[key].spent += spent - reserve;
        const entry = ledger[key];
        const counter = costKnown ? "confirmed" : "unverified";
        entry[counter] = (entry[counter] ?? 0) + spent;
        entry.transports[transport][counter] += spent;
        pendingBudgets.delete(budgetId);
        await persist();
      }
    } finally {
      releaseAdmission?.();
      releaseAdmission = undefined;
    }
  };
  try {
    const declaredBytes = Number(req.headers["content-length"]);
    if (declaredBytes > MAX_REQUEST_BYTES) {
      req.resume();
      return fail(
        res,
        413,
        "Request exceeds employee image/history payload limit (16 MiB); compact context or use smaller image previews",
      );
    }
    // Reserve before reading: queued clients cannot retain full JSON/image
    // buffers. Chunked requests reserve their maximum so partial reads cannot
    // deadlock one another under the aggregate memory bound.
    const weight =
      Number.isSafeInteger(declaredBytes) && declaredBytes >= 0
        ? declaredBytes
        : MAX_REQUEST_BYTES;
    releaseAdmission = await admission.acquire(
      account.name,
      weight,
      controller.signal,
    );
    if (controller.signal.aborted) return;
    key = new Date().toISOString().slice(0, 10) + ":" + account.name;
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        fail(
          res,
          413,
          "Request exceeds employee image/history payload limit (16 MiB); compact context or use smaller image previews",
        );
        return;
      }
      chunks.push(chunk);
    }
    const wireText = Buffer.concat(chunks).toString();
    const input = JSON.parse(wireText);
    const imageCount = (
      wireText.match(/"type"\s*:\s*"(?:image|input_image)"/g) || []
    ).length;
    if (size > 2 * 1024 * 1024)
      console.info(
        JSON.stringify({
          event: "employee_large_model_input",
          account: account.name,
          model: input.model,
          wireBytes: size,
          imageCount,
        }),
      );
    if (
      input.previous_response_id ||
      input.background ||
      input.store ||
      input.service_tier === "priority"
    )
      return fail(res, 403, "Model or state option unavailable");
    const selected = (await catalog()).find((m) => m.id === input.model);
    if (!selected)
      return fail(res, 403, "Model is not available in the OpenRouter catalog");
    const allowed = anthropic
      ? [
          "model",
          "messages",
          "system",
          "tools",
          "tool_choice",
          "stream",
          "temperature",
          "top_p",
          "top_k",
          "stop_sequences",
        ]
      : [
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
    let body = Object.fromEntries(
      allowed.filter((k) => k in input).map((k) => [k, input[k]]),
    );
    if (anthropic) {
      try {
        body = materializeEmployeeTools(body);
      } catch {
        return fail(res, 400, "Unsupported employee tool history");
      }
    }
    const safeTool = (t) =>
      anthropic
        ? (!t.type || t.type === "custom") &&
          typeof t.name === "string" &&
          t.input_schema?.type === "object"
        : ["function", "custom"].includes(t.type) ||
          (t.type === "namespace" &&
            Array.isArray(t.tools) &&
            t.tools.every(safeTool));
    if (Array.isArray(body.tools))
      body.tools = body.tools.filter(
        (t) => !["web_search", "web_search_preview"].includes(t.type),
      );
    if (body.tools?.some((t) => !safeTool(t)))
      return fail(res, 403, "Hosted tools unavailable");
    if (anthropic) body.max_tokens = MAX_OUTPUT_TOKENS;
    else {
      // Only the current employee catalog is executable. Historical catalogs
      // duplicate names and can resurrect tools no longer granted to the user.
      if (Array.isArray(body.input))
        body.input = body.input.filter(
          (item) => item.type !== "additional_tools",
        );
      body.max_output_tokens = MAX_OUTPUT_TOKENS;
      body.store = false;
    }
    const entry = ledger[key] ?? { spent: 0, requests: 0 };
    const remaining = account.dailyLimit - entry.spent;
    const maxOutput = MAX_OUTPUT_TOKENS;
    const inputBound = Math.min(
      selected.context_length ?? 2097152,
      size + imageCount * (selected.context_length ?? 2097152),
    );
    const promptPrice = Number(selected.pricing?.prompt);
    const completionPrice = Number(selected.pricing?.completion);
    const requestPrice = Number(selected.pricing?.request ?? 0);
    const auto = input.model === "openrouter/auto";
    if (
      !Number.isFinite(requestPrice) ||
      requestPrice < 0 ||
      (!auto &&
        (!Number.isFinite(promptPrice) ||
          !Number.isFinite(completionPrice) ||
          promptPrice < 0 ||
          completionPrice < 0))
    )
      return reject(502, "Model pricing is unavailable");
    // Auto must not reserve the employee's entire day and starve other chats.
    // The same ceiling also constrains provider routing, so it is a real bound.
    const autoBudget = Math.min(
      Math.max(0, remaining),
      account.autoMaxCost ?? 1,
    );
    const autoRate = autoBudget / (inputBound * 2 + maxOutput + 1);
    body.provider = {
      max_price: {
        prompt: (auto ? autoRate : promptPrice) * 1e6,
        completion: (auto ? autoRate : completionPrice) * 1e6,
        request: auto ? 0 : requestPrice,
      },
    };
    reserve = auto
      ? autoBudget
      : Math.max(
          0.000001,
          inputBound *
            Math.max(
              promptPrice * 2,
              Number(selected.pricing?.input_cache_write ?? 0),
            ) +
            maxOutput * completionPrice +
            requestPrice,
        );
    spent = reserve;
    if (entry.requests >= (account.maxRequests ?? 3000))
      return reject(429, "Employee daily model call limit reached");
    if (remaining <= 0 || entry.spent + reserve > account.dailyLimit)
      return reject(
        429,
        "Employee daily model budget is insufficient for this request",
      );
    entry.spent += reserve;
    entry.requests++;
    entry.legacyUpperBound ??= entry.spent - reserve;
    entry.trackingStartedAt ??= new Date().toISOString();
    entry.transports ??= {};
    transport = anthropic ? "claude" : "codex";
    entry.transports[transport] ??= {
      requests: 0,
      confirmed: 0,
      unverified: 0,
    };
    entry.transports[transport].requests++;
    pendingBudgets.set(budgetId, { key, reserve });
    ledger[key] = entry;
    // Persist reservation before spending; an unknown outcome retains its reservation.
    await persist();
    admitted = true;
    const upstream = await fetch(
      `https://openrouter.ai/api/v1/${anthropic ? "messages" : "responses"}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + cfg.upstreamKey,
          "content-type": "application/json",
          ...(anthropic ? { "anthropic-version": "2023-06-01" } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(120000),
        ]),
      },
    );
    if (!upstream.ok) {
      // Validation failures did not run inference; do not charge their reservation.
      if (upstream.status === 400 || upstream.status === 422) {
        spent = 0;
        costKnown = true;
      }
      const failure = await upstream.json().catch(() => null);
      let providerDetail;
      try {
        const raw = JSON.parse(failure?.error?.metadata?.raw ?? "null");
        providerDetail = raw?.error?.message ?? raw?.message;
      } catch {}
      const detail =
        typeof providerDetail === "string"
          ? providerDetail
              .slice(0, 400)
              .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
          : typeof failure?.error?.message === "string"
            ? failure.error.message
                .slice(0, 400)
                .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
            : "No provider error detail";
      await settle();
      return reject(
        502,
        `Model provider rejected the request (HTTP ${upstream.status}): ${detail}`,
      );
    }
    res.writeHead(200, {
      "content-type":
        upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-store",
    });
    accounting = new ResponseAccounting(body.stream === true, anthropic);
    for await (const chunk of upstream.body) {
      // SDKs may disconnect as soon as these terminal bytes arrive. Capture
      // authoritative billing first, including when the subsequent read aborts.
      accounting.consume(Buffer.from(chunk));
      if (!res.write(Buffer.from(chunk)))
        await once(res, "drain", { signal: controller.signal });
    }
    accounting.finish();
    // Release the slot before the client observes completion and sends a tool result.
    await settle();
    res.end();
  } catch (error) {
    if (error instanceof AdmissionError) {
      if (error.code !== "cancelled" && !res.destroyed)
        reject(429, error.message);
    } else if (!res.headersSent && !res.destroyed)
      reject(502, "Employee model request failed");
    else res.destroy();
  } finally {
    await settle().catch(() => {
      server.close();
      process.exitCode = 1;
    });
  }
});
server.headersTimeout = 10000;
server.requestTimeout = 150000;
server.maxConnections = 64;
server.on("upgrade", (_req, socket) =>
  socket.end(
    "HTTP/1.1 426 Upgrade Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
  ),
);
server.listen(3456, "127.0.0.1");
