import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewSessionDefaults } from "@yep-anywhere/shared";

const state = vi.hoisted(() => ({
  defaults: {} as NewSessionDefaults,
  update: vi.fn(),
}));
vi.mock("../../../hooks/useProviders", () => ({
  useProviders: () => ({
    loading: false,
    error: null,
    refetch: vi.fn(),
    providers: [
      {
        name: "claude",
        displayName: "Claude",
        installed: true,
        enabled: true,
        authenticated: true,
        models: [
          { id: "haiku", name: "Haiku" },
          { id: "sonnet", name: "Sonnet" },
        ],
      },
      {
        name: "codex",
        displayName: "Codex",
        installed: true,
        enabled: true,
        authenticated: true,
        models: [
          {
            id: "gpt-6-luna",
            name: "Luna",
            supportedEffortLevels: ["low", "medium", "high"],
          },
        ],
      },
      {
        name: "gemini",
        displayName: "Gemini",
        installed: true,
        enabled: true,
        authenticated: true,
        models: [{ id: "auto", name: "Auto" }],
      },
    ],
  }),
}));
vi.mock("../../../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    settings: { newSessionDefaults: state.defaults },
    isLoading: false,
    error: null,
    updateSetting: state.update,
  }),
}));
vi.mock("../SettingsPaneTitleContext", () => ({
  useSettingsPaneTitle: vi.fn(),
}));
vi.mock("../ProviderSignIn", () => ({ ProviderSignIn: () => null }));
import { PolzaCodexModelSettings } from "../PolzaCodexSettings";

afterEach(cleanup);
beforeEach(() => {
  state.defaults = {
    provider: "claude",
    permissionMode: "default",
    providers: {
      claude: { model: "haiku" },
      codex: { model: "gpt-6-luna", effortLevel: "medium" },
      gemini: { model: "auto" },
    },
  };
  state.update.mockReset();
  state.update.mockImplementation(async (_key, next) => {
    state.defaults = next;
  });
});
describe("Polza workspace model defaults", () => {
  it("shows the actual default provider instead of always showing Codex", () => {
    render(<PolzaCodexModelSettings />);
    expect((screen.getByLabelText("Сервис") as HTMLSelectElement).value).toBe(
      "claude",
    );
    expect((screen.getByLabelText("Модель") as HTMLSelectElement).value).toBe(
      "haiku",
    );
  });
  it("changing a Claude model preserves its provider, permissions and other model profiles", async () => {
    render(<PolzaCodexModelSettings />);
    fireEvent.change(screen.getByLabelText("Модель"), {
      target: { value: "sonnet" },
    });
    await waitFor(() => expect(state.update).toHaveBeenCalledOnce());
    expect(state.update.mock.calls[0]).toEqual([
      "newSessionDefaults",
      expect.objectContaining({
        provider: "claude",
        permissionMode: "default",
        providers: {
          claude: { model: "sonnet" },
          codex: { model: "gpt-6-luna", effortLevel: "medium" },
          gemini: { model: "auto" },
        },
      }),
    ]);
  });
  it("an explicit provider switch restores that provider's model and preserves the previous profile", async () => {
    render(<PolzaCodexModelSettings />);
    fireEvent.change(screen.getByLabelText("Сервис"), {
      target: { value: "codex" },
    });
    await waitFor(() => expect(state.update).toHaveBeenCalledOnce());
    expect(state.defaults.provider).toBe("codex");
    expect(state.defaults.providers?.codex).toEqual({
      model: "gpt-6-luna",
      effortLevel: "medium",
    });
    expect(state.defaults.providers?.claude?.model).toBe("haiku");
  });
  it("does not offer unsupported reasoning levels for Gemini", async () => {
    state.defaults = { ...state.defaults, provider: "gemini" };
    render(<PolzaCodexModelSettings />);
    expect((screen.getByLabelText("Модель") as HTMLSelectElement).value).toBe(
      "auto",
    );
    expect(screen.queryByLabelText("Глубина рассуждения")).toBeNull();
  });
});
