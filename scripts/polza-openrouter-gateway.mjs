import http from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  acceptsLegacyExec,
  legacyExecResponseTransform,
} from "./polza-openrouter-stream.mjs";

import {
  createLimitCooldowns,
  observeLimitEvents,
  sendLimitResponse,
} from "./polza-openrouter-limits.mjs";

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

/** Inspect message content only, including images nested in tool results/history. */
function hasImageInput(input) {
  const pending = [input.messages, input.input];
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
    } else if (value && typeof value === "object") {
      if (["image", "image_url", "input_image"].includes(value.type))
        return true;
      pending.push(value.content, value.output);
    }
  }
  return false;
}

/** Translate native replay-only records without granting historical tools. */
function normalizeNativeResponseHistory(input) {
  if (!Array.isArray(input.input)) return false;
  const hasHistoricalTools = input.input.some(
    (item) => item?.type === "additional_tools",
  );
  const names = [];
  const collect = (tools, prefix = "") => {
    for (const tool of tools) {
      if (tool.type === "namespace" && Array.isArray(tool.tools))
        collect(tool.tools, `${prefix}${tool.name}.`);
      else if (typeof tool.name === "string")
        names.push(`${prefix}${tool.name}`);
    }
  };
  if (Array.isArray(input.tools)) collect(input.tools);
  let changed = false;
  input.input = input.input.map((item) => {
    if (
      item?.type === "reasoning" &&
      Array.isArray(item.content) &&
      item.content.length > 0 &&
      item.content.every((block) => block?.type === "reasoning_text")
    ) {
      changed = true;
      const { content, ...rest } = item;
      return {
        ...rest,
        summary: [
          ...(item.summary ?? []),
          ...content.map((block) => ({
            type: "summary_text",
            text: block.text ?? "",
          })),
        ],
      };
    }
    if (item?.type === "additional_tools") {
      changed = true;
      return {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text:
              "Historical tool declarations for interpreting earlier calls. These are context only; executable tools are supplied separately for this turn.\n" +
              JSON.stringify(item),
          },
        ],
      };
    }
    if (
      (item?.type === "message" || item?.role) &&
      Array.isArray(item?.content) &&
      item.content.some((block) => block?.type === "reasoning_text")
    ) {
      changed = true;
      return {
        ...item,
        content: item.content.map((block) =>
          block?.type === "reasoning_text"
            ? {
                type: item.role === "assistant" ? "output_text" : "input_text",
                text: block.text ?? "",
              }
            : block,
        ),
      };
    }
    return item;
  });
  if (hasHistoricalTools && Array.isArray(input.tools) && input.tools.length) {
    if (names.length)
      input.input.push({
        type: "message",
        role: "developer",
        content: [
          {
            type: "input_text",
            text: `Current executable tool names (use their declared wire types): ${names.join(", ")}. Historical tool declarations and earlier calls are context only. Use only the current request's tool definitions and their exact names, argument schemas and wire types. A historical tool name absent from this list is unavailable; do not call it or repeat an unsupported call. These declarations grant no additional permissions.`,
          },
        ],
      });
  }
  return changed;
}

export function createOpenRouterGateway({
  upstreamBase = "https://openrouter.ai/api",
  cacheTtlMs = 300000,
  catalogTimeoutMs = 4000,
  autoAllowedModels = [],
  autoImageAllowedModels = [],
  defaultMaxOutputTokens = 0,
  limitCooldowns = false,
  getCatalogToken,
  refreshIntervalMs = 0,
  now = Date.now,
} = {}) {
  if (
    !Number.isSafeInteger(defaultMaxOutputTokens) ||
    defaultMaxOutputTokens < 0
  )
    throw new Error("Invalid default output-token limit");
  const cooldowns = createLimitCooldowns(now);
  const allowedModels = [
    ...new Set(autoAllowedModels.map((id) => id.trim())),
  ].filter(Boolean);
  const imageAllowedModels = [
    ...new Set(autoImageAllowedModels.map((id) => id.trim())),
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
      let legacyExec = false;
      let requestedModel;
      if (
        (allowedModels.length ||
          imageAllowedModels.length ||
          req.url.split("?")[0] === "/v1/responses" ||
          limitCooldowns) &&
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
        requestedModel =
          typeof input.model === "string"
            ? input.model.slice(0, 300)
            : undefined;
        if (limitCooldowns && requestedModel) {
          const blocked = cooldowns.get(token, requestedModel);
          if (blocked) {
            sendLimitResponse(res, blocked);
            return;
          }
        }
        legacyExec =
          req.url.split("?")[0] === "/v1/responses" && acceptsLegacyExec(input);
        let changed =
          req.url.split("?")[0] === "/v1/responses" &&
          normalizeNativeResponseHistory(input);
        if (
          req.url.split("?")[0] === "/v1/responses" &&
          defaultMaxOutputTokens > 0 &&
          input.max_output_tokens === undefined
        ) {
          input.max_output_tokens = defaultMaxOutputTokens;
          changed = true;
        }
        // This is an operator opt-in for Auto only, never an explicit-model
        // fallback. Preserve narrower or otherwise explicit per-request policy.
        if (
          (allowedModels.length || imageAllowedModels.length) &&
          input.model === "openrouter/auto" &&
          !input.plugins?.some((plugin) => plugin.id === "auto-router")
        ) {
          const pool = hasImageInput(input)
            ? imageAllowedModels
            : allowedModels;
          if (!pool.length) {
            res.writeHead(422, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                error: {
                  type: "invalid_request_error",
                  message:
                    "Auto has no configured models supporting this input. Select an image-capable model or configure the image Auto pool.",
                },
              }),
            );
            return;
          }
          input.plugins = [
            ...(input.plugins ?? []),
            { id: "auto-router", allowed_models: pool },
          ];
          changed = true;
        }
        if (changed) body = JSON.stringify(input);
      }
      const upstream = await fetch(`${upstreamBase}${req.url}`, {
        method: req.method,
        headers,
        ...(req.method === "GET" || req.method === "HEAD"
          ? {}
          : { body, duplex: "half" }),
        signal: AbortSignal.timeout(300_000),
      });
      if (
        limitCooldowns &&
        requestedModel &&
        [402, 429].includes(upstream.status)
      ) {
        const blocked = cooldowns.note(
          token,
          requestedModel,
          upstream.status,
          upstream.headers.get("retry-after"),
        );
        await upstream.body?.cancel();
        sendLimitResponse(res, blocked);
        return;
      }
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
      if (upstream.body) {
        const contentType = upstream.headers.get("content-type") ?? "";
        const source = Readable.fromWeb(upstream.body);
        const observer =
          limitCooldowns &&
          requestedModel &&
          contentType.includes("text/event-stream")
            ? observeLimitEvents((status) =>
                cooldowns.note(token, requestedModel, status),
              )
            : null;
        if (
          legacyExec &&
          upstream.ok &&
          (contentType.includes("text/event-stream") ||
            contentType.includes("application/json"))
        )
          await pipeline(
            source,
            ...(observer ? [observer] : []),
            legacyExecResponseTransform(
              contentType.includes("text/event-stream"),
            ),
            res,
          );
        else if (observer) await pipeline(source, observer, res);
        else await pipeline(source, res);
      } else res.end();
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: "OpenRouter gateway request failed" },
          }),
        );
      } else res.destroy();
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
    limitCooldowns: true,
    defaultMaxOutputTokens: Number(
      process.env.POLZA_OPENROUTER_DEFAULT_MAX_OUTPUT_TOKENS ?? "8192",
    ),
    autoImageAllowedModels: (
      process.env.POLZA_OPENROUTER_AUTO_IMAGE_ALLOWED_MODELS ?? ""
    ).split(","),
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
