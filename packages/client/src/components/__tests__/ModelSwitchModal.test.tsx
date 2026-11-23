// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelSwitchModal } from "../ModelSwitchModal";

const {
  mockGetProcessInfo,
  mockGetProcessModels,
  mockSetProcessConfig,
  mockGetProvider,
  mockTranslate,
  mockVersion,
} = vi.hoisted(() => ({
  mockGetProcessInfo: vi.fn(),
  mockGetProcessModels: vi.fn(),
  mockSetProcessConfig: vi.fn(),
  mockGetProvider: vi.fn(),
  mockTranslate: vi.fn((key: string) => key),
  mockVersion: { current: { capabilities: [] as string[] } },
}));

vi.mock("../../api/client", () => ({
  api: {
    getProcessInfo: mockGetProcessInfo,
    getProcessModels: mockGetProcessModels,
    setProcessConfig: mockSetProcessConfig,
    getProvider: mockGetProvider,
  },
}));

vi.mock("../../hooks/useModelSettings", () => ({
  getEffortLevel: () => "high",
  getShowThinkingSetting: () => true,
  getThinkingMode: () => "off",
  useModelSettings: () => ({
    setEffortLevel: vi.fn(),
    setThinkingMode: vi.fn(),
  }),
}));

vi.mock("../../hooks/useProviderSubscriptionUsage", () => ({
  useProviderSubscriptionUsage: () => ({
    usage: null,
    loading: false,
    supported: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("../../hooks/useVersion", () => ({
  useVersion: () => ({ version: mockVersion.current, loading: false }),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: mockTranslate }),
}));

describe("ModelSwitchModal", () => {
  beforeEach(() => {
    mockGetProcessModels.mockResolvedValue({ models: [] });
    mockGetProcessInfo.mockResolvedValue({
      process: {
        model: "latest",
        provider: "claude",
        thinking: undefined,
        effort: "high",
      },
    });
    mockSetProcessConfig.mockResolvedValue({
      success: true,
      processId: "process-1",
      model: "other",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    localStorage.clear();
    mockVersion.current = { capabilities: [] };
  });

  it.each(["claude", "codex"] as const)(
    "opens %s handoff even while the router catalog never resolves",
    (target) => {
      vi.stubEnv("VITE_POLZA_ADMIN_UI", "true");
      mockGetProcessModels.mockReturnValue(new Promise(() => {}));
      const handoff = vi.fn();
      const close = vi.fn();
      render(
        <ModelSwitchModal
          sessionId="session-1"
          processId="process-1"
          sessionProvider="claude-gateway"
          onModelChanged={vi.fn()}
          onClose={close}
          onHandoffProvider={handoff}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", {
          name:
            target === "claude"
              ? "polzaHandoffToClaude"
              : "polzaHandoffToCodex",
        }),
      );
      expect(handoff).toHaveBeenCalledWith(target);
      expect(close).toHaveBeenCalledOnce();
      expect(mockGetProvider).not.toHaveBeenCalled();
      expect(mockSetProcessConfig).not.toHaveBeenCalled();
    },
  );

  it("abandons a pending router probe when the user chooses a native handoff", async () => {
    vi.stubEnv("VITE_POLZA_ADMIN_UI", "true");
    let resolve!: (value: unknown) => void;
    mockGetProvider.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const switchProvider = vi.fn();
    const handoff = vi.fn();
    render(
      <ModelSwitchModal
        sessionId="session-1"
        processId="process-1"
        sessionProvider="claude"
        onModelChanged={vi.fn()}
        onClose={vi.fn()}
        onSwitchProvider={switchProvider}
        onHandoffProvider={handoff}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "OpenRouter" }));
    fireEvent.click(
      screen.getByRole("button", { name: "polzaHandoffToCodex" }),
    );
    expect(handoff).toHaveBeenCalledWith("codex");
    resolve({
      provider: {
        enabled: true,
        installed: true,
        authenticated: true,
        models: [{ id: "openrouter/auto", name: "Auto" }],
      },
    });
    await waitFor(() => expect(mockGetProvider).toHaveBeenCalledOnce());
    expect(switchProvider).not.toHaveBeenCalled();
  });

  it("keeps the picker open and the prior routing choice when an in-place switch is rejected", async () => {
    vi.stubEnv("VITE_POLZA_ADMIN_UI", "true");
    localStorage.setItem("polza-model-routing:session-1", "manual");
    mockGetProvider.mockResolvedValue({
      provider: {
        installed: true,
        enabled: true,
        authenticated: true,
        models: [{ id: "openrouter/auto", name: "Auto" }],
      },
    });
    const onSwitch = vi.fn().mockRejectedValue(new Error("Session is busy"));
    const onClose = vi.fn();
    render(
      <ModelSwitchModal
        sessionId="session-1"
        processId="process-1"
        sessionProvider="claude"
        onModelChanged={vi.fn()}
        onClose={onClose}
        onSwitchProvider={onSwitch}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "OpenRouter" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Session is busy"),
    );
    expect(onSwitch).toHaveBeenCalledWith("claude-gateway", "openrouter/auto");
    expect(onClose).not.toHaveBeenCalled();
    expect(localStorage.getItem("polza-model-routing:session-1")).toBe(
      "manual",
    );
    expect(mockSetProcessConfig).not.toHaveBeenCalled();
  });

  it("searches a large gateway catalog and applies the selected ID to the same process", async () => {
    vi.stubEnv("VITE_POLZA_ADMIN_UI", "true");
    mockGetProcessModels.mockResolvedValue({
      models: [
        ...Array.from({ length: 320 }, (_, i) => ({
          id: `vendor/model-${i}`,
          name: `Catalog model ${i}`,
        })),
        { id: "qwen/coder", name: "Qwen Coder" },
      ],
    });
    mockGetProcessInfo.mockResolvedValue({
      process: {
        model: "qwen/coder",
        provider: "claude-gateway",
        effort: "high",
      },
    });
    const onClose = vi.fn();
    render(
      <ModelSwitchModal
        sessionId="session-1"
        processId="process-1"
        sessionProvider="claude-gateway"
        onModelChanged={vi.fn()}
        onClose={onClose}
      />,
    );
    await screen.findByRole("button", { name: "Catalog model 319" });
    const search = screen.getByRole("searchbox", { name: "modelSwitchSearch" });
    fireEvent.change(search, { target: { value: "QWEN/CO" } });
    expect(
      screen.queryByRole("button", { name: "Catalog model 319" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Qwen Coder/ }));
    await waitFor(() =>
      expect(mockSetProcessConfig).toHaveBeenCalledWith(
        "process-1",
        expect.objectContaining({ model: "qwen/coder" }),
      ),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("reflects saved Grok without a browser flag and really applies Auto before closing", async () => {
    vi.stubEnv("VITE_POLZA_ADMIN_UI", "true");
    mockGetProcessModels.mockResolvedValue({
      models: [
        { id: "x-ai/grok-4", name: "Grok" },
        { id: "openrouter/auto", name: "Router Auto" },
      ],
    });
    mockGetProcessInfo.mockResolvedValue({
      process: {
        model: "openrouter/auto",
        requestedModel: "x-ai/grok-4",
        provider: "codex-oss",
        effort: "high",
      },
    });
    const onClose = vi.fn();
    const onModelChanged = vi.fn();
    mockSetProcessConfig.mockRejectedValueOnce(new Error("Session is busy"));
    render(
      <ModelSwitchModal
        sessionId="session-1"
        processId="process-1"
        currentModel="openrouter/auto"
        sessionProvider="codex-oss"
        onModelChanged={onModelChanged}
        onClose={onClose}
      />,
    );
    const grok = await screen.findByRole("button", { name: "Grok" });
    await waitFor(() => expect(grok.getAttribute("aria-current")).toBe("true"));
    const auto = screen.getByRole("button", { name: "Авто" });
    expect(auto.getAttribute("aria-current")).toBeNull();
    fireEvent.click(auto);
    await screen.findByText("Session is busy");
    expect(onClose).not.toHaveBeenCalled();
    expect(onModelChanged).not.toHaveBeenCalled();
    expect(grok.getAttribute("aria-current")).toBe("true");
    const receipt = {
      success: true,
      processId: "process-1",
      model: "openrouter/auto",
    };
    mockSetProcessConfig.mockResolvedValueOnce(receipt);
    fireEvent.click(auto);
    await waitFor(() => expect(onModelChanged).toHaveBeenCalledWith(receipt));
    expect(mockSetProcessConfig).toHaveBeenLastCalledWith(
      "process-1",
      expect.objectContaining({ model: "openrouter/auto" }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("turns off routing after an accepted manual choice in the full settings tab", async () => {
    vi.stubEnv("VITE_POLZA_ADMIN_UI", "true");
    mockGetProcessModels.mockResolvedValue({
      models: [
        { id: "latest", name: "Latest" },
        { id: "other", name: "Other" },
      ],
    });
    const onClose = vi.fn();
    render(
      <ModelSwitchModal
        sessionId="session-1"
        processId="process-1"
        initialTab="info"
        infoPane={<div>Session details</div>}
        onModelChanged={vi.fn()}
        onClose={onClose}
      />,
    );
    Object.defineProperty(
      document.querySelector(".modal-content"),
      "scrollTo",
      { value: vi.fn() },
    );
    fireEvent.click(screen.getByRole("tab", { name: "newSessionModelTitle" }));
    fireEvent.click(await screen.findByRole("button", { name: /Other/ }));
    fireEvent.click(
      (
        await screen.findAllByRole("button", { name: /modelSwitchSaveAll/ })
      )[0]!,
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(localStorage.getItem("polza-model-routing:session-1")).toBe(
      "manual",
    );
  });

  it("resets the shared modal scroller when switching tabs", () => {
    render(
      <ModelSwitchModal
        sessionId="session-1"
        currentModel="model-1"
        infoPane={<div>Session details</div>}
        initialTab="info"
        onModelChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const modalContent = document.querySelector(".modal-content");
    expect(modalContent).toBeInstanceOf(HTMLElement);
    const scrollTo = vi.fn();
    Object.defineProperty(modalContent, "scrollTo", { value: scrollTo });

    fireEvent.click(screen.getByRole("tab", { name: "newSessionModelTitle" }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    expect(screen.queryByText("Session details")).toBeNull();
  });

  it("groups additional choices and preserves a missing current model", async () => {
    mockGetProcessModels.mockResolvedValue({
      models: [
        { id: "latest", name: "Latest" },
        {
          id: "previous",
          name: "Previous",
          catalogGroup: "additional",
        },
      ],
    });
    mockGetProcessInfo.mockResolvedValue({
      process: {
        model: "removed-current",
        provider: "claude",
        thinking: undefined,
        effort: "high",
      },
    });

    render(
      <ModelSwitchModal
        processId="process-1"
        sessionId="session-1"
        currentModel="removed-current"
        onModelChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Previous")).toBeTruthy();
    });
    expect(screen.getAllByText("previousModelsGroup")).toHaveLength(1);
    expect(screen.getAllByText("removed-current").length).toBeGreaterThan(0);
    expect(screen.getByText("modelSelectionUnavailable")).toBeTruthy();
  });

  it("dismisses dirty changes without saving", async () => {
    mockGetProcessModels.mockResolvedValue({
      models: [
        { id: "latest", name: "Latest" },
        { id: "other", name: "Other" },
      ],
    });
    const onClose = vi.fn();

    render(
      <ModelSwitchModal
        processId="process-1"
        sessionId="session-1"
        currentModel="latest"
        onModelChanged={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Other/ }));
    fireEvent.click(screen.getByRole("button", { name: "modalClose" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockSetProcessConfig).not.toHaveBeenCalled();
  });

  it("asks the effort guard before applying and stops on skip", async () => {
    mockGetProcessModels.mockResolvedValue({
      models: [{ id: "latest", name: "Latest" }],
    });
    const guardEffortChange = vi.fn().mockResolvedValue("skip");

    render(
      <ModelSwitchModal
        processId="process-1"
        sessionId="session-1"
        currentModel="latest"
        onModelChanged={vi.fn()}
        guardEffortChange={guardEffortChange}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /effortLevelMaxLabel/ }),
    );
    const saveButtons = await screen.findAllByRole("button", {
      name: /modelSwitchSaveAll/,
    });
    const saveButton = saveButtons[0];
    if (!saveButton) throw new Error("Expected a save button");
    fireEvent.click(saveButton);

    await waitFor(() => {
      // The mocked process has no thinking config, which the modal reads as
      // thinking off, so the guard sees off → on:max.
      expect(guardEffortChange).toHaveBeenCalledWith("on:max", "off", {
        changesModel: false,
      });
    });
    expect(mockSetProcessConfig).not.toHaveBeenCalled();
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("tells the effort guard when the save also changes the model", async () => {
    mockGetProcessModels.mockResolvedValue({
      models: [
        { id: "latest", name: "Latest" },
        { id: "other", name: "Other" },
      ],
    });
    const guardEffortChange = vi.fn().mockResolvedValue("apply");

    render(
      <ModelSwitchModal
        processId="process-1"
        sessionId="session-1"
        currentModel="latest"
        onModelChanged={vi.fn()}
        guardEffortChange={guardEffortChange}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Other/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /effortLevelMaxLabel/ }),
    );
    const saveButtons = await screen.findAllByRole("button", {
      name: /modelSwitchSaveAll/,
    });
    const saveButton = saveButtons[0];
    if (!saveButton) throw new Error("Expected a save button");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockSetProcessConfig).toHaveBeenCalledWith("process-1", {
        model: "other",
        thinking: "on:max",
        showThinking: true,
      });
    });
    expect(guardEffortChange).toHaveBeenCalledWith("on:max", "off", {
      changesModel: true,
    });
  });

  it("dismisses while an explicit save remains pending", async () => {
    mockGetProcessModels.mockResolvedValue({
      models: [
        { id: "latest", name: "Latest" },
        { id: "other", name: "Other" },
      ],
    });
    let resolveConfig!: (result: {
      success: boolean;
      processId: string;
      model: string;
    }) => void;
    mockSetProcessConfig.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveConfig = resolve;
        }),
    );
    const onClose = vi.fn();
    const onModelChanged = vi.fn();

    render(
      <ModelSwitchModal
        processId="process-1"
        sessionId="session-1"
        currentModel="latest"
        onModelChanged={onModelChanged}
        onClose={onClose}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Other/ }));
    const saveButtons = await screen.findAllByRole("button", {
      name: /modelSwitchSaveAll/,
    });
    const saveButton = saveButtons[0];
    if (!saveButton) throw new Error("Expected a model save button");
    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(mockSetProcessConfig).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "modalClose" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    resolveConfig({ success: true, processId: "process-1", model: "other" });
    await waitFor(() => {
      expect(onModelChanged).toHaveBeenCalledTimes(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("speed", () => {
    const codexModels = {
      models: [
        {
          id: "gpt-5.6-sol",
          name: "GPT-5.6-Sol",
          serviceTiers: [
            { id: "priority", name: "Fast", description: "1.5x speed" },
          ],
        },
        { id: "gpt-5.6-luna", name: "GPT-5.6-Luna" },
      ],
    };

    beforeEach(() => {
      mockGetProcessModels.mockResolvedValue(codexModels);
      mockGetProcessInfo.mockResolvedValue({
        process: {
          model: "gpt-5.6-sol",
          provider: "codex",
          thinking: undefined,
          effort: "high",
        },
      });
    });

    const renderModal = (onClose = vi.fn()) =>
      render(
        <ModelSwitchModal
          processId="process-1"
          sessionId="session-1"
          currentModel="gpt-5.6-sol"
          onModelChanged={vi.fn()}
          onClose={onClose}
        />,
      );

    it("applies a tier on its own and keeps the modal open", async () => {
      mockVersion.current = { capabilities: ["process-service-tier-change"] };
      mockSetProcessConfig.mockResolvedValue({
        success: true,
        processId: "process-1",
        serviceTier: "priority",
      });
      const onClose = vi.fn();
      renderModal(onClose);

      const standard = await screen.findByRole("button", {
        name: "serviceTierStandardLabel",
      });
      expect(standard.getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Fast" }));

      await waitFor(() => {
        expect(
          screen
            .getByRole("button", { name: "Fast" })
            .getAttribute("aria-pressed"),
        ).toBe("true");
      });
      expect(mockSetProcessConfig).toHaveBeenCalledWith("process-1", {
        serviceTier: "priority",
      });
      expect(onClose).not.toHaveBeenCalled();
    });

    it("offers Standard for a live tier the catalog no longer lists", async () => {
      mockVersion.current = { capabilities: ["process-service-tier-change"] };
      mockGetProcessInfo.mockResolvedValue({
        process: {
          model: "gpt-5.6-luna",
          provider: "codex",
          effort: "high",
          serviceTier: "ultrafast",
        },
      });
      mockSetProcessConfig.mockResolvedValue({
        success: true,
        processId: "process-1",
        serviceTier: null,
      });
      renderModal();

      const ultra = await screen.findByRole("button", {
        name: "serviceTierUltraFastLabel",
      });
      expect(ultra.getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(
        screen.getByRole("button", { name: "serviceTierStandardLabel" }),
      );
      await waitFor(() => {
        expect(mockSetProcessConfig).toHaveBeenCalledWith("process-1", {
          serviceTier: null,
        });
      });
    });

    it("hides the control from servers without live tier changes", async () => {
      renderModal();

      await screen.findByText("GPT-5.6-Luna");
      expect(screen.queryByText("modelSwitchSpeedLabel")).toBeNull();
    });
  });
});
