import type { RenderItem } from "@yep-anywhere/shared/transcript/items";

/** Presentation only: keep native diagnostics intact, and never filter errors. */
export function isPolzaAutoModelNotice(item: RenderItem): boolean {
  if (item.type !== "system" || item.subtype !== "warning") return false;
  const text = item.content.trim();
  return (
    text ===
      "Model metadata for `openrouter/auto` not found. Defaulting to fallback metadata; this can degrade performance and cause issues." ||
    /^This session was recorded with model `([^`\r\n]+)` but is resuming with `openrouter\/auto`\. Consider switching back to `\1` as it may affect Codex performance\.$/.test(
      text,
    )
  );
}
