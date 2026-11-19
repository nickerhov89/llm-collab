import { expect, it } from "vitest";
import type { RenderItem } from "@yep-anywhere/shared/transcript/items";
import { isPolzaAutoModelNotice } from "../polzaModelNotices";

const metadata =
  "Model metadata for `openrouter/auto` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.";
const changed =
  "This session was recorded with model `gpt-6-luna` but is resuming with `openrouter/auto`. Consider switching back to `gpt-6-luna` as it may affect Codex performance.";
const notice = (
  content: string,
  subtype: "warning" | "error" = "warning",
): RenderItem => ({
  type: "system",
  id: "notice",
  subtype,
  content,
  sourceMessages: [],
});
it("recognizes only the two standalone Auto notices and preserves actual errors", () => {
  expect(isPolzaAutoModelNotice(notice(metadata))).toBe(true);
  expect(isPolzaAutoModelNotice(notice(changed))).toBe(true);
  for (const content of [
    metadata,
    changed,
    "HTTP 401: invalid API key",
    "HTTP 429: rate limit exceeded",
    "Request exceeds context window",
    "Network timeout",
  ]) {
    expect(isPolzaAutoModelNotice(notice(content, "error"))).toBe(false);
  }
  expect(
    isPolzaAutoModelNotice(notice(metadata + "\nHTTP 403: access denied")),
  ).toBe(false);
  expect(
    isPolzaAutoModelNotice(
      notice(metadata.replace("openrouter/auto", "qwen/custom")),
    ),
  ).toBe(false);
  expect(
    isPolzaAutoModelNotice(
      notice(
        changed.replace(
          "resuming with `openrouter/auto`",
          "resuming with `qwen/custom`",
        ),
      ),
    ),
  ).toBe(false);
  expect(
    isPolzaAutoModelNotice({
      type: "text",
      id: "message",
      text: metadata,
      sourceBlockIndex: 0,
      sourceMessages: [],
    }),
  ).toBe(false);
});
