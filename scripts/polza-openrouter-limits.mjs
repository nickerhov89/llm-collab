import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/** Demand-driven bounded cooldowns: no polling and no retained credentials. */
export function createLimitCooldowns(now = Date.now) {
  const entries = new Map();
  const scope = (token, model, account = false) =>
    createHash("sha256").update(token).digest("hex") +
    ":" +
    (account ? "account" : "model:" + model);
  function get(token, model) {
    for (const key of [scope(token, model, true), scope(token, model)]) {
      const entry = entries.get(key);
      if (!entry) continue;
      if (entry.until <= now()) {
        entries.delete(key);
        continue;
      }
      return {
        ...entry,
        retryAfter: Math.max(1, Math.ceil((entry.until - now()) / 1000)),
      };
    }
    return null;
  }
  function note(token, model, status, retryAfter) {
    if (status !== 402 && status !== 429) return null;
    const seconds = Number(retryAfter);
    const date = typeof retryAfter === "string" ? Date.parse(retryAfter) : NaN;
    const delay =
      retryAfter != null && Number.isFinite(seconds) && seconds > 0
        ? seconds * 1000
        : Number.isFinite(date) && date > now()
          ? date - now()
          : 30000;
    const key = scope(token, model, status === 402);
    entries.delete(key);
    entries.set(key, {
      status,
      until: now() + Math.min(86400000, Math.max(1000, delay)),
    });
    while (entries.size > 256) entries.delete(entries.keys().next().value);
    return get(token, model);
  }
  return { get, note };
}
export function sendLimitResponse(res, entry, providerLabel = "OpenRouter") {
  res.writeHead(entry.status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "retry-after": String(entry.retryAfter),
  });
  res.end(
    JSON.stringify({
      error: {
        type:
          entry.status === 429 ? "rate_limit_error" : "insufficient_credits",
        code:
          entry.status === 429 ? "rate_limit_exceeded" : "insufficient_credits",
        message:
          entry.outputBudget?.kind === "input"
            ? `${providerLabel} отклонил стоимость контекста: ${entry.outputBudget.requestedTokens} токенов при доступном лимите ${entry.outputBudget.affordableTokens} для этого запроса. Выберите более дешёвую модель или пополните баланс. История не обрезана; другие запросы не заблокированы.`
            : entry.outputBudget
              ? `${providerLabel} отклонил резерв ответа: запрошено ${entry.outputBudget.requestedTokens} токенов, доступно до ${entry.outputBudget.affordableTokens}. Уменьшите max_tokens или пополните общий баланс. Чат сохранён; другие запросы не заблокированы.`
              : entry.status === 402
                ? `${providerLabel}: исчерпан доступный баланс или лимит расходов аккаунта. Чат сохранён. Пополните баланс или дождитесь освобождения резерва и повторите сообщение в этом чате.`
                : `${providerLabel}: временный лимит запросов. Повторите сообщение в этом чате через ${entry.retryAfter} сек.`,
        retry_after: entry.retryAfter,
      },
    }),
  );
}
/** Observe SSE quota failures even when the HTTP response was 200; bytes stay intact. */
export function observeLimitEvents(onLimit) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  return new Transform({
    transform(chunk, _encoding, callback) {
      this.push(chunk);
      pending = (pending + decoder.write(chunk)).replace(/\r\n/g, "\n");
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
        try {
          const e = JSON.parse(data);
          const error = e.error ?? e.response?.error;
          if (error) {
            const code = error.code ?? error.type;
            const status =
              Number(code) === 402 ||
              ["insufficient_credits", "quota_exceeded"].includes(code)
                ? 402
                : Number(code) === 429 ||
                    ["rate_limit_error", "rate_limit_exceeded"].includes(code)
                  ? 429
                  : null;
            if (status) onLimit(status);
          }
        } catch {}
      }
      // Do not buffer oversized text deltas just to inspect their status.
      if (pending.length > 65536) pending = "";
      callback();
    },
  });
}

/** Read only a bounded pre-generation credit error; never retain its text or URLs. */
export async function readCreditBudgetLimit(response) {
  if (response.status !== 402 || !response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      size += value.byteLength;
      if (size > 65536) return null;
      chunks.push(Buffer.from(value));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const message = data.error?.message;
    if (typeof message !== "string") return null;
    const match = message.match(
      /requested up to (\d+) tokens, but can only afford (\d+)/i,
    );
    const inputMatch = message.match(
      /Prompt tokens limit exceeded:\s*(\d+)\s*>\s*(\d+)/i,
    );
    if (!match && !inputMatch) return null;
    const counts = match ?? inputMatch;
    const requestedTokens = Number(counts[1]);
    const affordableTokens = Number(counts[2]);
    if (
      !Number.isSafeInteger(requestedTokens) ||
      !Number.isSafeInteger(affordableTokens) ||
      requestedTokens <= affordableTokens ||
      affordableTokens < 0
    )
      return null;
    return {
      requestedTokens,
      affordableTokens,
      kind: match ? "output" : "input",
      // Only this platform preflight is safe for a single automatic resubmit.
      canAdapt: data.metadata?.limit_source === "openrouter_credits",
    };
  } catch {
    return null;
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function affordableOutputRetry(input, limit) {
  if (!input || !limit?.canAdapt || limit.kind === "input") return null;
  const fields = [
    "max_tokens",
    "max_output_tokens",
    "max_completion_tokens",
  ].filter((name) => Object.hasOwn(input, name));
  if (fields.length !== 1) return null;
  const field = fields[0];
  const original = input[field];
  const capped = Math.floor((limit.affordableTokens * 0.95) / 128) * 128;
  if (!Number.isSafeInteger(original) || capped < 128 || capped >= original)
    return null;
  // Do not silently change an explicit reasoning budget to make it fit.
  if (
    input.thinking?.type === "enabled" &&
    input.thinking.budget_tokens >= capped
  )
    return null;
  return { ...input, [field]: capped };
}
