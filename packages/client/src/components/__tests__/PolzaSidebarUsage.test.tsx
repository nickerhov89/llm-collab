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
  summary: null as import("@yep-anywhere/shared").ModelUsageSummary | null,
}));
vi.mock("../../hooks/useModelUsage", () => ({
  useModelUsage: () => ({
    usage: state.summary,
    loading: false,
    refresh: vi.fn(),
  }),
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
  state.summary = null;
});
const usage = (
  provider: ProviderName,
  percent: number,
): ProviderSubscriptionUsage => ({
  provider,
  fetchedAt: new Date().toISOString(),
  windows: [{ id: "quota", usedPercent: percent, scope: { type: "provider" } }],
});

it("distinguishes missing quota from a genuine reported zero", () => {
  state.usage = {
    claude: usage("claude", 0),
    codex: usage("codex", Number.NaN),
    gemini: null,
  };
  render(<PolzaSidebarUsage />);
  expect(screen.getByText("Claude")).toBeTruthy();
  expect(screen.getByText("0%")).toBeTruthy();
  expect(screen.queryByText("gemini")).toBeNull();
  expect(screen.getByText("Codex")).toBeTruthy();
  expect(screen.getByText("OpenRouter")).toBeTruthy();
  expect(screen.getAllByText("Нет данных").length).toBe(2);
});

it("shows actual Router billing and labels shared spend separately from own reservations", () => {
  state.summary = {
    account: "marker",
    active: 2,
    queued: 1,
    concurrency: 4,
    dailyBudget: 10,
    spentOrReservedToday: 2,
    confirmedSinceTracking: 0.12,
    unverifiedReserved: 0.3,
    legacyUpperBound: 1.5,
    inflightReserved: 0.08,
    requestsToday: 21,
    transports: { codex: { requests: 12, confirmed: 0.12, unverified: 0 } },
    billing: {
      source: "openrouter-api",
      fetchedAt: "2026-11-17T12:00:00Z",
      utcDay: "2026-11-17",
      spentToday: 0.975,
      spentTotal: 1.77,
      keyLimit: 10,
      keyRemaining: 8.23,
      creditBalance: 6.63,
      stale: false,
    },
  };
  render(<PolzaSidebarUsage />);
  expect(screen.getByText("12 запр.")).toBeTruthy();
  expect(screen.getByText("$0.975")).toBeTruthy();
  fireEvent.click(screen.getByText("OpenRouter"));
  expect(screen.getByText(/общий ключ сотрудников/)).toBeTruthy();
  expect(screen.getByText(/очередь: 1/)).toBeTruthy();
  expect(screen.queryByText("$2.00")).toBeNull();
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
