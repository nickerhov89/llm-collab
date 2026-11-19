// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RenderItem } from "@yep-anywhere/shared/transcript/items";
import { I18nProvider } from "../../i18n";
import { RenderItemComponent } from "../RenderItemComponent";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
it("hides only Auto warnings in the branded feed while preserving errors and vanilla diagnostics", () => {
  const items: RenderItem[] = [
    {
      type: "system",
      id: "auto",
      subtype: "warning",
      sourceMessages: [],
      content:
        "Model metadata for `openrouter/auto` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.",
    },
    {
      type: "system",
      id: "other",
      subtype: "warning",
      sourceMessages: [],
      content: "Another provider warning",
    },
    {
      type: "system",
      id: "error",
      subtype: "error",
      sourceMessages: [],
      content: "HTTP 401: invalid API key",
    },
  ];
  for (const branded of [true, false]) {
    vi.stubEnv("VITE_POLZA_ADMIN_UI", String(branded));
    const { container } = render(
      <I18nProvider>
        {items.map((item) => (
          <RenderItemComponent
            key={item.id}
            item={item}
            isStreaming={false}
            thinkingExpanded={false}
            toggleThinkingExpanded={() => {}}
          />
        ))}
      </I18nProvider>,
    );
    expect(container.querySelectorAll(".system-message-warning")).toHaveLength(
      branded ? 1 : 2,
    );
    expect(container.querySelectorAll(".system-message-error")).toHaveLength(1);
    expect(container.textContent).toContain("HTTP 401: invalid API key");
    expect(container.textContent).toContain("Another provider warning");
    expect(items[0]?.type === "system" && items[0].content).toContain(
      "openrouter/auto",
    );
    cleanup();
  }
});
