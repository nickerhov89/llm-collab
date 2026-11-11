// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  ProviderName,
  ProviderSubscriptionUsage,
} from "@yep-anywhere/shared";
import { afterEach, expect, it, vi } from "vitest";
import { PolzaSidebarUsage } from "../PolzaSidebarUsage";

const state = vi.hoisted(() => ({
  usage: {} as Record<string, ProviderSubscriptionUsage | null>,
}));
vi.mock("../../hooks/useProviders", () => ({
  useProviders: () => ({
    providers: ["claude", "codex", "gemini"].map((name) => ({
      name,
      displayName: name,
      installed: true,
      authenticated: true,
    })),
  }),
}));
vi.mock("../../hooks/useProviderSubscriptionUsage", () => ({
  useProviderSubscriptionUsage: (provider: string) => ({
    usage: state.usage[provider],
    loading: false,
    supported: true,
    error: null,
    refresh: vi.fn(),
  }),
}));
afterEach(() => {
  cleanup();
  state.usage = {};
});
const usage = (
  provider: ProviderName,
  percent: number,
): ProviderSubscriptionUsage => ({
  provider,
  fetchedAt: new Date().toISOString(),
  windows: [{ id: "quota", usedPercent: percent, scope: { type: "provider" } }],
});

it("hides absent/invalid usage and shows a real zero instead of a placeholder", () => {
  state.usage = {
    claude: usage("claude", 0),
    codex: usage("codex", Number.NaN),
    gemini: null,
  };
  render(<PolzaSidebarUsage />);
  expect(screen.getByText("claude")).toBeTruthy();
  expect(screen.getByText("0%")).toBeTruthy();
  expect(screen.queryByText("gemini")).toBeNull();
  expect(screen.queryByText("codex")).toBeNull();
});

it("shows any provider only when reported data arrives and removes it when data disappears", () => {
  const view = render(<PolzaSidebarUsage />);
  expect(screen.queryByText("gemini")).toBeNull();
  state.usage.gemini = usage("gemini", 32);
  view.rerender(<PolzaSidebarUsage />);
  fireEvent.click(screen.getByText("gemini"));
  expect(screen.getByText("Лимиты gemini")).toBeTruthy();
  state.usage.gemini = { ...state.usage.gemini, windows: [] };
  view.rerender(<PolzaSidebarUsage />);
  expect(screen.queryByText("gemini")).toBeNull();
  expect(screen.queryByText("Лимиты gemini")).toBeNull();
});
