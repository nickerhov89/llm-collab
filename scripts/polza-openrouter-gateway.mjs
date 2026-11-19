import http from "node:http";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const host = "127.0.0.1";
const port = Number(process.env.OPENROUTER_GATEWAY_PORT ?? "3451");
async function operatorToken() {
  const token = (
    await readFile(
      process.env.POLZA_OPENROUTER_KEY_FILE ??
        join(homedir(), ".config/polza/openrouter-cowork.key"),
      "utf8",
    )
  ).trim();
  if (!token || token === "dummy")
    throw new Error("Missing gateway credential");
  return token;
}

export function createOpenRouterGateway({
  upstreamBase = "https://openrouter.ai/api",
  cacheTtlMs = 300000,
  catalogTimeoutMs = 4000,
  autoAllowedModels = [],
  getCatalogToken,
  refreshIntervalMs = 0,
  now = Date.now,
} = {}) {
  const allowedModels = [
    ...new Set(autoAllowedModels.map((id) => id.trim())),
  ].filter(Boolean);
  let models = [];
  let refreshedAt = 0;
  let refreshing;
  let attemptedAt = null;
  let lastError = null;
  let refreshTimer;
  const catalogStatus = () => ({
    state: models.length ? (lastError ? "stale" : "ready") : "unavailable",
    count: models.length,
    refreshedAt: models.length ? refreshedAt : null,
    attemptedAt,
    lastError,
    source: getCatalogToken ? "account" : "public",
    refreshIntervalMs,
    refreshing: !!refreshing,
  });
  async function refreshModels() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      attemptedAt = now();
      const token = await getCatalogToken?.();
      if (getCatalogToken && !token)
        throw new Error("Missing catalog credential");
      const upstream = await fetch(
        `${upstreamBase}/v1/models${token ? "/user" : ""}`,
        {
          ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
          signal: AbortSignal.timeout(catalogTimeoutMs),
        },
      );
      if (!upstream.ok) throw new Error(`Catalog HTTP ${upstream.status}`);
      const data = (await upstream.json()).data;
      if (!Array.isArray(data)) throw new Error("Invalid model catalog");
      const seen = new Set();
      const next = data
        .filter((row) => {
          if (
            typeof row?.id !== "string" ||
            seen.has(row.id) ||
            row.id.endsWith(":batch")
          )
            return false;
          if (
            !row.architecture?.output_modalities?.includes("text") ||
            !row.supported_parameters?.includes("tools")
          )
            return false;
          seen.add(row.id);
          return true;
        })
        .map((row) => ({
          id: row.id,
          name: row.name || row.id,
          object: "model",
          owned_by: row.id.split("/")[0],
          ...(Array.isArray(row.architecture?.input_modalities)
            ? {
                input_modalities: row.architecture.input_modalities.filter(
                  (v) => typeof v === "string",
                ),
              }
            : {}),
          ...(Number.isFinite(row.context_length) && row.context_length > 0
            ? { max_model_len: row.context_length }
            : {}),
        }));
      if (!next.length) throw new Error("Empty agent model catalog");
      // Auto stays available and visibly first, without replacing the selected model.
      next.sort((a, b) => a.id.localeCompare(b.id));
      if (!seen.has("openrouter/auto"))
        next.unshift({
          id: "openrouter/auto",
          name: "OpenRouter Auto",
          object: "model",
          owned_by: "openrouter",
        });
      else
        next.unshift(
          next.splice(
            next.findIndex((row) => row.id === "openrouter/auto"),
            1,
          )[0],
        );
      models = next;
      refreshedAt = now();
      lastError = null;
      return models;
    })()
      .catch((error) => {
        // Never expose errors containing credentials, URLs or request contents.
        lastError = /^Catalog HTTP \d{3}$/.test(error?.message ?? "")
          ? error.message
          : "Catalog refresh failed";
        throw error;
      })
      .finally(() => {
        refreshing = undefined;
      });
    return refreshing;
  }
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, catalog: catalogStatus() }));
      return;
    }
    if (req.method === "POST" && req.url === "/catalog/refresh") {
      if (req.headers.authorization !== "Bearer dummy") {
        res.writeHead(401);
        res.end();
        return;
      }
      try {
        await refreshModels();
        res.writeHead(200, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify({ catalog: catalogStatus(), data: models }));
      } catch {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Catalog refresh failed",
            catalog: catalogStatus(),
          }),
        );
      }
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
      try {
        if (!models.length) await refreshModels();
        else if (now() - refreshedAt >= cacheTtlMs)
          void refreshModels().catch(() => {});
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: models }));
      } catch {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: "OpenRouter model catalog temporarily unavailable",
            },
          }),
        );
      }
      return;
    }
    if (
      !req.url?.startsWith("/v1/") ||
      !req.headers.authorization?.startsWith("Bearer ")
    ) {
      res.writeHead(401);
      res.end();
      return;
    }
    try {
      // Claude Gateway deliberately sends a dummy local credential. Resolve the
      // operator's existing OpenRouter credential here, never in browser state.
      const token =
        req.headers.authorization === "Bearer dummy"
          ? await operatorToken()
          : req.headers.authorization.slice(7);
      if (!token || token === "dummy")
        throw new Error("Missing gateway credential");
      const headers = {
        authorization: `Bearer ${token}`,
        "content-type": req.headers["content-type"] ?? "application/json",
        accept: req.headers.accept ?? "text/event-stream",
        ...(req.headers["anthropic-version"]
          ? { "anthropic-version": req.headers["anthropic-version"] }
          : {}),
      };
      let body = req;
      if (
        allowedModels.length &&
        req.method === "POST" &&
        ["/v1/messages", "/v1/responses", "/v1/chat/completions"].includes(
          req.url.split("?")[0],
        )
      ) {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 64 * 1024 * 1024) {
            res.writeHead(413, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                error: { message: "Gateway JSON body exceeds 64 MiB" },
              }),
            );
            return;
          }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
        let input;
        try {
          input = JSON.parse(body.toString("utf8"));
          if (!input || typeof input !== "object" || Array.isArray(input))
            throw new Error("Expected an inference object");
        } catch {
          // JSON parser errors can quote private prompt text. Never log them.
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ error: { message: "Invalid inference JSON" } }),
          );
          return;
        }
        // This is an operator opt-in for Auto only, never an explicit-model
        // fallback. Preserve narrower or otherwise explicit per-request policy.
        if (
          input.model === "openrouter/auto" &&
          !input.plugins?.some((plugin) => plugin.id === "auto-router")
        ) {
          input.plugins = [
            ...(input.plugins ?? []),
            { id: "auto-router", allowed_models: allowedModels },
          ];
          body = JSON.stringify(input);
        }
      }
      const upstream = await fetch(`${upstreamBase}${req.url}`, {
        method: req.method,
        headers,
        ...(req.method === "GET" || req.method === "HEAD"
          ? {}
          : { body, duplex: "half" }),
        signal: AbortSignal.timeout(300_000),
      });
      // Transport metadata only: never log prompts, request headers or tokens.
      console.info(
        "OpenRouter response",
        req.method,
        req.url.split("?")[0],
        upstream.status,
      );
      const responseHeaders = {};
      for (const name of ["content-type", "cache-control", "x-request-id"]) {
        const value = upstream.headers.get(name);
        if (value) responseHeaders[name] = value;
      }
      res.writeHead(upstream.status, responseHeaders);
      if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
      else res.end();
    } catch (error) {
      if (!res.headersSent)
        res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: "OpenRouter gateway request failed" },
        }),
      );
      console.error(
        "upstream request failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  });
  // The local bridge serves SSE. Signal unsupported WebSocket transport locally
  // instead of forwarding upgrade probes as authenticated upstream GET requests.
  server.on("upgrade", (_req, socket) => {
    socket.end(
      "HTTP/1.1 426 Upgrade Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
    );
  });
  if (refreshIntervalMs > 0) {
    server.once("listening", () => {
      const refresh = () => {
        void refreshModels().catch(() => {});
      };
      refresh();
      refreshTimer = setInterval(refresh, refreshIntervalMs);
      refreshTimer.unref();
    });
    server.once("close", () => clearInterval(refreshTimer));
  }
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = createOpenRouterGateway({
    getCatalogToken: operatorToken,
    refreshIntervalMs: 15 * 60 * 1000,
    autoAllowedModels: (
      process.env.POLZA_OPENROUTER_AUTO_ALLOWED_MODELS ?? ""
    ).split(","),
  });
  server.listen(port, host, () =>
    console.log(`OpenRouter gateway listening on ${host}:${port}`),
  );
}
