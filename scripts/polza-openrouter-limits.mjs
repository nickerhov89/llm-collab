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
export function sendLimitResponse(res, entry) {
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
          entry.status === 402
            ? "OpenRouter: исчерпан доступный баланс или лимит расходов аккаунта. Чат сохранён. Пополните баланс или дождитесь освобождения резерва и повторите сообщение в этом чате."
            : `OpenRouter: временный лимит запросов. Повторите сообщение в этом чате через ${entry.retryAfter} сек.`,
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
