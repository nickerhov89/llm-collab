import {
  type EffortLevel,
  type ModelInfo,
  type ModelServiceTier,
  type ProviderName,
  SERVER_CAPABILITIES,
  serverHasCapability,
  type ThinkingOption,
} from "@yep-anywhere/shared";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import styles from "./ModelSwitchModal.module.css";
import { api } from "../api/client";
import {
  getEffortLevel,
  getShowThinkingSetting,
  getThinkingMode,
  useModelSettings,
} from "../hooks/useModelSettings";
import { useProviderSubscriptionUsage } from "../hooks/useProviderSubscriptionUsage";
import { useVersion } from "../hooks/useVersion";
import { useI18n } from "../i18n";
import {
  getEffortLevelLabel,
  getEffortLevelOptions,
  getThinkingModeOptions,
  resolveSupportedEffortLevel,
  resolveSupportedThinkingMode,
} from "../lib/effortLevels";
import {
  getIndicatorToneFromProcess,
  getIndicatorToneFromSelection,
  getThinkingModeFromProcess,
  normalizeEffortLevel,
} from "../lib/modelConfigIndicator";
import {
  startsAdditionalModelGroup,
  withVisibleModelSelection,
} from "../lib/modelCatalog";
import { polzaGatewayProvider, usePolzaAutoModel } from "../lib/polzaAutoModel";
import { polzaModelLabel } from "../lib/polzaModelLabel";
import {
  isStandardServiceTier,
  selectableServiceTiers,
  serviceTierLabel,
} from "../lib/serviceTiers";
import { ProviderBadge } from "./ProviderBadge";
import { ModelSubscriptionUsage } from "./ModelSubscriptionUsage";
import { Modal } from "./ui/Modal";

interface ModelSwitchModalProps {
  /** Live owned process id; absent when the session isn't an owned live process. */
  processId?: string;
  sessionId: string;
  currentModel?: string;
  /** Session provider, for effort labels/tones when no process is live. */
  sessionProvider?: ProviderName;
  onModelChanged: (next: {
    processId: string;
    model?: string;
    thinking?: { type: string };
    effort?: string;
  }) => void;
  /**
   * Long-context effort-change gate (topics/mid-session-effort-change.md).
   * Called before applying a config whose effort differs from the current
   * one; `skip` means the user cancelled or forked instead, so nothing is
   * applied here.
   */
  guardEffortChange?: (
    nextThinking: ThinkingOption,
    currentThinking: ThinkingOption,
    options: { changesModel: boolean },
  ) => Promise<"apply" | "skip">;
  /** When provided, renders an "Info" tab whose pane is this node. */
  infoPane?: ReactNode;
  /** Which tab is focused on open (default "model"). */
  initialTab?: "model" | "info";
  /**
   * Spawn a live process for a reaped session without sending a turn
   * (message-less reactivate). When provided, the Model tab's "No active
   * process" note becomes an Activate button; on success the parent flips
   * ownership so `processId` arrives and the full options load.
   */
  onActivate?: () => Promise<void>;
  onSwitchProvider?: (provider: ProviderName, model: string) => Promise<void>;
  onClose: () => void;
}

type ThinkingMode = "off" | "auto" | "on";
type DirtySection = "thinking" | "effort" | "model" | null;

function toThinkingOption(
  mode: ThinkingMode,
  effort: EffortLevel,
): "off" | "auto" | `on:${EffortLevel}` {
  if (mode === "off") return "off";
  if (mode === "auto") return "auto";
  return `on:${effort}`;
}

function sameSelection(
  modelA: string | undefined,
  modeA: ThinkingMode,
  effortA: EffortLevel,
  modelB: string | undefined,
  modeB: ThinkingMode,
  effortB: EffortLevel,
): boolean {
  if (modelA !== modelB || modeA !== modeB) {
    return false;
  }
  if (modeA !== "on") {
    return true;
  }
  return effortA === effortB;
}

export function ModelSwitchModal({
  processId,
  sessionId,
  currentModel,
  sessionProvider,
  onModelChanged,
  guardEffortChange,
  infoPane,
  initialTab,
  onActivate,
  onSwitchProvider,
  onClose,
}: ModelSwitchModalProps) {
  const { t } = useI18n();
  const [autoModel, setAutoModel] = usePolzaAutoModel(sessionId);
  const { setThinkingMode, setEffortLevel } = useModelSettings();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [provider, setProvider] = useState<ProviderName | null>(null);
  const { usage: subscriptionUsage } = useProviderSubscriptionUsage(provider);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [currentThinkingMode, setCurrentThinkingMode] =
    useState<ThinkingMode>("off");
  const [currentEffortLevel, setCurrentEffortLevel] =
    useState<EffortLevel>("high");
  const [currentModelId, setCurrentModelId] = useState<string | undefined>(
    currentModel,
  );
  const [thinkingMode, setThinkingModeState] = useState<ThinkingMode>("off");
  const [effortLevel, setEffortLevelState] = useState<EffortLevel>("high");
  const [selectedModel, setSelectedModel] = useState<string | undefined>(
    currentModel,
  );
  const [lastTouchedSection, setLastTouchedSection] =
    useState<DirtySection>(null);
  const [activeTab, setActiveTab] = useState<"model" | "info">(
    initialTab ?? "model",
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const quickMenuRef = useRef<HTMLDivElement>(null);
  const quickActivationStartedRef = useRef(false);
  const [, updateQuickMenuViewport] = useState(0);
  const dismissedRef = useRef(false);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  /** Live process tier; null is Standard. */
  const [currentServiceTier, setCurrentServiceTier] = useState<string | null>(
    null,
  );
  const [savingServiceTier, setSavingServiceTier] = useState(false);
  const { version } = useVersion();
  const supportsServiceTierChange = serverHasCapability(
    version,
    SERVER_CAPABILITIES.processServiceTierChange,
  );
  const polzaQuickMenu =
    import.meta.env.VITE_POLZA_ADMIN_UI === "true" && initialTab !== "info";

  useEffect(() => {
    if (!polzaQuickMenu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!quickMenuRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    const reposition = () => updateQuickMenuViewport((value) => value + 1);
    window.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [onClose, polzaQuickMenu]);

  useEffect(() => {
    if (!processId) {
      // No live process: the status row shows what the next send will
      // request. The idle-send path resolves thinking via
      // getThinkingSetting() (getImplicitComposerThinking in SessionPage),
      // which reads the same stored mode/effort the composer's thinking
      // chooser edits while the session is idle.
      const requestedMode = getThinkingMode();
      const requestedEffort = getEffortLevel();
      setProvider(sessionProvider ?? null);
      setCurrentThinkingMode(requestedMode);
      setThinkingModeState(requestedMode);
      setCurrentEffortLevel(requestedEffort);
      setEffortLevelState(requestedEffort);
      setLoading(false);
      return;
    }
    // processId may have just appeared (e.g. after Activate) - show the spinner
    // while models load rather than flashing the empty state.
    setLoading(true);
    let cancelled = false;

    Promise.all([
      api.getProcessModels(processId),
      api.getProcessInfo(sessionId),
    ])
      .then(([modelsRes, processRes]) => {
        if (cancelled) return;

        const process = processRes.process;
        const resolvedModel =
          process?.model ?? currentModel ?? modelsRes.models[0]?.id;
        const processProvider = process?.provider ?? null;
        const resolvedEffort = normalizeEffortLevel(
          process?.effort,
          processProvider,
        );
        const resolvedThinkingMode = getThinkingModeFromProcess(
          process?.thinking,
          process?.effort,
        );

        setModels(
          withVisibleModelSelection(
            modelsRes.models,
            resolvedModel,
            t("modelSelectionUnavailable"),
          ),
        );
        setProvider(processProvider);
        setCurrentModelId(resolvedModel);
        setSelectedModel(resolvedModel);
        setCurrentThinkingMode(resolvedThinkingMode);
        setThinkingModeState(resolvedThinkingMode);
        setCurrentEffortLevel(resolvedEffort);
        setEffortLevelState(resolvedEffort);
        setCurrentServiceTier(
          isStandardServiceTier(process?.serviceTier)
            ? null
            : (process?.serviceTier ?? null),
        );
        setLastTouchedSection(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || t("modelSwitchLoadFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentModel, processId, sessionId, sessionProvider, t]);

  const selectedModelInfo = useMemo(
    () => models.find((model) => model.id === selectedModel) ?? null,
    [models, selectedModel],
  );
  const effortOptions = useMemo(
    () =>
      getEffortLevelOptions({
        provider,
        model: selectedModelInfo,
        translate: t,
      }),
    [provider, selectedModelInfo, t],
  );
  const effectiveEffortLevel = resolveSupportedEffortLevel(
    effortLevel,
    effortOptions,
  );
  const thinkingModeOptions = useMemo(
    () =>
      getThinkingModeOptions({
        provider,
        model: selectedModelInfo,
        effortOptions,
      }),
    [effortOptions, provider, selectedModelInfo],
  );
  const effectiveThinkingMode = resolveSupportedThinkingMode(
    thinkingMode,
    thinkingModeOptions,
  );
  const showEffortOptions = thinkingModeOptions.includes("on");
  // Tiers belong to the running model; a model switch keeps the current tier
  // and Codex drops it for a model that does not offer it.
  const currentModelInfo = useMemo(
    () => models.find((model) => model.id === currentModelId) ?? null,
    [models, currentModelId],
  );
  const serviceTierOptions = useMemo((): ModelServiceTier[] => {
    const offered = selectableServiceTiers(currentModelInfo?.serviceTiers);
    if (
      currentServiceTier &&
      !offered.some((tier) => tier.id === currentServiceTier)
    ) {
      offered.push({
        id: currentServiceTier,
        name: serviceTierLabel(currentServiceTier, undefined, t),
      });
    }
    return offered;
  }, [currentModelInfo, currentServiceTier, t]);
  const showServiceTierOptions =
    !!processId && supportsServiceTierChange && serviceTierOptions.length > 0;

  const dirty =
    !loading &&
    !sameSelection(
      currentModelId,
      currentThinkingMode,
      currentEffortLevel,
      selectedModel,
      effectiveThinkingMode,
      effectiveEffortLevel,
    );

  const applyConfig = async (afterApply?: () => void) => {
    if (switching || !selectedModel || !processId) return;
    setSwitching(true);
    setError(null);
    try {
      const thinking = toThinkingOption(
        effectiveThinkingMode,
        effectiveEffortLevel,
      );
      if (guardEffortChange) {
        const verdict = await guardEffortChange(
          thinking,
          toThinkingOption(currentThinkingMode, currentEffortLevel),
          { changesModel: selectedModel !== currentModelId },
        );
        if (verdict === "skip") {
          if (!dismissedRef.current) setSwitching(false);
          return;
        }
      }
      const result = await api.setProcessConfig(processId, {
        model: selectedModel,
        thinking,
        showThinking: getShowThinkingSetting(),
      });
      setThinkingMode(effectiveThinkingMode);
      setEffortLevel(effectiveEffortLevel);
      onModelChanged(result);
      if (!dismissedRef.current) {
        dismissedRef.current = true;
        onClose();
      }
      afterApply?.();
    } catch (err: unknown) {
      if (!dismissedRef.current) {
        setError(
          err instanceof Error ? err.message : t("modelSwitchChangeFailed"),
        );
        setSwitching(false);
      }
    }
  };

  // Speed applies on its own: a live tier change needs no restart, while
  // combining it with a model or effort change would force one.
  const applyServiceTier = async (serviceTier: string | null) => {
    if (!processId || savingServiceTier || serviceTier === currentServiceTier)
      return;
    setSavingServiceTier(true);
    setError(null);
    try {
      const result = await api.setProcessConfig(processId, { serviceTier });
      if (dismissedRef.current) return;
      setCurrentServiceTier(
        isStandardServiceTier(result.serviceTier)
          ? null
          : (result.serviceTier ?? null),
      );
    } catch (err: unknown) {
      if (!dismissedRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : t("modelSwitchSpeedChangeFailed"),
        );
      }
    } finally {
      if (!dismissedRef.current) setSavingServiceTier(false);
    }
  };

  const handleDismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    onClose();
  };

  const handleTabChange = (tab: "model" | "info") => {
    setActiveTab(tab);
    contentRef.current?.closest(".modal-content")?.scrollTo({ top: 0 });
  };

  const handleActivate = useCallback(async () => {
    if (!onActivate || activating) return;
    setActivating(true);
    setActivateError(null);
    try {
      await onActivate();
      // On success the parent flips ownership; `processId` arrives as a prop,
      // the model-load effect fires, and the full options replace this note.
    } catch (err) {
      setActivateError(
        err instanceof Error ? err.message : t("modelSwitchActivateFailed"),
      );
    } finally {
      setActivating(false);
    }
  }, [activating, onActivate, t]);

  useEffect(() => {
    if (
      !polzaQuickMenu ||
      processId ||
      !onActivate ||
      quickActivationStartedRef.current
    )
      return;
    quickActivationStartedRef.current = true;
    void handleActivate();
  }, [handleActivate, onActivate, polzaQuickMenu, processId]);

  const currentIndicatorTone = getIndicatorToneFromProcess(
    { type: currentThinkingMode === "off" ? "disabled" : "adaptive" },
    currentThinkingMode === "on" ? currentEffortLevel : undefined,
    provider,
  );
  const pendingIndicatorTone = getIndicatorToneFromSelection(
    effectiveThinkingMode,
    effectiveEffortLevel,
  );
  const renderThinkingLabel = (mode: ThinkingMode, effort: EffortLevel) => {
    if (mode === "off") return t("newSessionThinkingOff");
    if (mode === "auto") return t("newSessionThinkingAuto");
    return t("newSessionThinkingOn", {
      level: getEffortLevelLabel(effort, provider, t),
    });
  };
  const renderConfigBadge = (
    modelId: string | undefined,
    mode: ThinkingMode,
    effort: EffortLevel,
    tone: string,
  ) => (
    <span className="model-switch-action-badge">
      <span
        className={`model-switch-indicator-dot tone-${tone}`}
        aria-hidden="true"
      />
      <span className="model-switch-action-badge-main">
        {modelId ?? t("processInfoDefaultModel")}
      </span>
      <span className="model-switch-action-badge-detail">
        {renderThinkingLabel(mode, effort)}
      </span>
    </span>
  );
  const renderInlineSave = () => (
    <button
      type="button"
      className="settings-button model-switch-inline-save"
      onClick={() => void applyConfig()}
      disabled={switching || !selectedModel}
    >
      {t("modelSwitchSaveAll")}
    </button>
  );

  const selectQuickModel = async (model: ModelInfo) => {
    if (!processId || switching) return;
    const nextEffortOptions = getEffortLevelOptions({
      provider,
      model,
      translate: t,
    });
    const nextEffort = resolveSupportedEffortLevel(
      currentEffortLevel,
      nextEffortOptions,
    );
    const nextModes = getThinkingModeOptions({
      provider,
      model,
      effortOptions: nextEffortOptions,
    });
    const nextMode = resolveSupportedThinkingMode(
      currentThinkingMode,
      nextModes,
    );
    const nextThinking = toThinkingOption(nextMode, nextEffort);
    setSwitching(true);
    setError(null);
    try {
      if (guardEffortChange) {
        const verdict = await guardEffortChange(
          nextThinking,
          toThinkingOption(currentThinkingMode, currentEffortLevel),
          { changesModel: model.id !== currentModelId },
        );
        if (verdict === "skip") {
          setSwitching(false);
          return;
        }
      }
      const result = await api.setProcessConfig(processId, {
        model: model.id,
        thinking: nextThinking,
        showThinking: getShowThinkingSetting(),
      });
      setThinkingMode(nextMode);
      setEffortLevel(nextEffort);
      setAutoModel(false);
      onModelChanged(result);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("modelSwitchChangeFailed"),
      );
      setSwitching(false);
    }
  };

  if (polzaQuickMenu) {
    const anchor = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".polza-combined-model-button,.polza-model-button",
      ),
    )
      .find((button) => button.getClientRects().length > 0)
      ?.getBoundingClientRect();
    return createPortal(
      <div
        ref={quickMenuRef}
        className={`polza-model-menu ${styles.quickMenu}`}
        role="dialog"
        aria-label="Select model"
        style={{
          right: anchor
            ? Math.min(
                Math.max(12, window.innerWidth - anchor.right),
                Math.max(
                  12,
                  window.innerWidth -
                    Math.min(400, window.innerWidth - 24) -
                    12,
                ),
              )
            : 12,
          bottom: anchor
            ? Math.max(12, window.innerHeight - anchor.top + 8)
            : 88,
          maxHeight: Math.max(
            80,
            Math.min(
              520,
              (anchor?.top ?? window.innerHeight - 88) -
                (window.visualViewport?.offsetTop ?? 0) -
                20,
            ),
          ),
        }}
      >
        <div className="polza-model-menu-heading">Выбор модели</div>
        <button
          type="button"
          className="polza-model-menu-item"
          aria-current={autoModel ? "true" : undefined}
          disabled={switching}
          onClick={() => {
            setAutoModel(true);
            onClose();
          }}
        >
          <span>Авто</span>
          <span aria-hidden="true">{autoModel ? "✓" : ""}</span>
        </button>
        {onSwitchProvider && polzaGatewayProvider(sessionProvider) && (
          <button
            type="button"
            className="polza-model-menu-item"
            disabled={switching}
            onClick={async () => {
              const target = polzaGatewayProvider(sessionProvider);
              if (!target) return;
              setSwitching(true);
              setSwitchError(null);
              try {
                const { provider: info } = await api.getProvider(target);
                const model = info.models?.find(
                  (m) =>
                    m.id === "openrouter/auto" ||
                    m.id.endsWith("::openrouter/auto"),
                );
                if (
                  !info.enabled ||
                  !info.installed ||
                  !info.authenticated ||
                  !model
                ) {
                  throw new Error(t("polzaRouterUnavailable"));
                }
                await onSwitchProvider(target, model.id);
                setAutoModel(true);
                onClose();
              } catch (err) {
                setSwitchError(
                  err instanceof Error
                    ? err.message
                    : t("modelSwitchChangeFailed"),
                );
              } finally {
                setSwitching(false);
              }
            }}
          >
            <span>{switching ? t("polzaRouterSwitching") : "OpenRouter"}</span>
            <span aria-hidden="true">
              {sessionProvider === "claude-gateway" ||
              sessionProvider === "codex-oss"
                ? "✓"
                : ""}
            </span>
          </button>
        )}
        {switchError && (
          <div className="polza-model-menu-message" role="alert">
            {switchError}
          </div>
        )}
        {loading ? (
          <div className="polza-model-menu-message">
            {t("modelSwitchLoading")}
          </div>
        ) : error ? (
          <div className="polza-model-menu-message" role="alert">
            {error}
          </div>
        ) : !processId ? (
          <div className="polza-model-menu-message">
            <span>
              {activating
                ? t("modelSwitchActivating")
                : t("processInfoNoActiveProcess")}
            </span>
            {onActivate && (
              <button
                type="button"
                className="polza-model-menu-activate"
                onClick={() => void handleActivate()}
                disabled={activating}
              >
                {activating
                  ? t("modelSwitchActivating")
                  : t("modelSwitchActivate")}
              </button>
            )}
            {activateError && <span role="alert">{activateError}</span>}
          </div>
        ) : (
          <div className="polza-model-menu-list">
            {models.map((model) => (
              <button
                key={model.id}
                type="button"
                className="polza-model-menu-item"
                onClick={() => void selectQuickModel(model)}
                disabled={switching}
                aria-current={
                  !autoModel && currentModelId === model.id ? "true" : undefined
                }
              >
                <span>{polzaModelLabel(model.name)}</span>
                {!autoModel && currentModelId === model.id && (
                  <span aria-hidden="true">✓</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>,
      document.body,
    );
  }

  return (
    <Modal
      title={t(activeTab === "info" ? "processInfoTitle" : "modelSwitchTitle")}
      onClose={handleDismiss}
    >
      <div ref={contentRef} className="model-switch-content">
        {infoPane && (
          <div className="model-switch-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "model"}
              className={`model-switch-tab ${activeTab === "model" ? "active" : ""}`}
              onClick={() => handleTabChange("model")}
            >
              {t("newSessionModelTitle")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "info"}
              className={`model-switch-tab ${activeTab === "info" ? "active" : ""}`}
              onClick={() => handleTabChange("info")}
            >
              {t("processInfoTitle")}
            </button>
          </div>
        )}
        {infoPane && activeTab === "info" && (
          <div className="model-switch-info-pane">{infoPane}</div>
        )}
        {(!infoPane || activeTab === "model") && loading && (
          <div className="model-switch-loading">{t("modelSwitchLoading")}</div>
        )}

        {(!infoPane || activeTab === "model") && !loading && (
          <>
            <div className="model-switch-status">
              <div className="model-switch-status-row">
                <span className="model-switch-status-marker">
                  {processId
                    ? t("modelSwitchCurrent")
                    : t("modelSwitchNextSend")}
                </span>
                <span
                  className={`model-switch-indicator-dot tone-${currentIndicatorTone}`}
                  aria-hidden="true"
                />
                <span className="model-switch-status-main">
                  {currentModelId ??
                    currentModel ??
                    t("processInfoDefaultModel")}
                </span>
                <span className="model-switch-status-detail">
                  {renderThinkingLabel(currentThinkingMode, currentEffortLevel)}
                </span>
              </div>
              {dirty && (
                <div className="model-switch-status-row pending">
                  <span
                    className="model-switch-status-marker"
                    aria-hidden="true"
                  >
                    →
                  </span>
                  <span
                    className={`model-switch-indicator-dot tone-${pendingIndicatorTone}`}
                    aria-hidden="true"
                  />
                  <span className="model-switch-status-main">
                    {selectedModel ??
                      currentModelId ??
                      t("processInfoDefaultModel")}
                  </span>
                  <span className="model-switch-status-detail">
                    {renderThinkingLabel(
                      effectiveThinkingMode,
                      effectiveEffortLevel,
                    )}
                  </span>
                </div>
              )}
            </div>
            {!processId && (
              <div className="model-switch-activate">
                <span className="model-switch-activate-note">
                  {t("processInfoNoActiveProcess")}
                </span>
                {onActivate && (
                  <button
                    type="button"
                    className="settings-button model-switch-inline-save"
                    onClick={handleActivate}
                    disabled={activating}
                  >
                    {activating
                      ? t("modelSwitchActivating")
                      : t("modelSwitchActivate")}
                  </button>
                )}
                {activateError && (
                  <div className="model-switch-error">{activateError}</div>
                )}
              </div>
            )}
            {error && <div className="model-switch-error">{error}</div>}

            {processId && (
              <section className="model-switch-section">
                <div className="model-switch-section-header">
                  <strong>{t("newSessionThinkingMode")}</strong>
                </div>
                <div className="model-switch-chip-group">
                  {thinkingModeOptions.map((mode) => {
                    const isCurrent = currentThinkingMode === mode;
                    const isSelected = effectiveThinkingMode === mode;
                    const showInlineSave =
                      dirty && lastTouchedSection === "thinking" && isSelected;
                    return (
                      <Fragment key={mode}>
                        <button
                          type="button"
                          className={`model-switch-chip ${isCurrent ? "current" : ""} ${isSelected ? "active" : ""}`}
                          onClick={() => {
                            if (effectiveThinkingMode !== mode) {
                              setLastTouchedSection("thinking");
                            }
                            setThinkingModeState(mode);
                          }}
                          disabled={switching}
                        >
                          <span
                            className={`model-switch-indicator-dot tone-${
                              mode === "off"
                                ? "off"
                                : mode === "auto"
                                  ? "auto"
                                  : effectiveEffortLevel
                            }`}
                            aria-hidden="true"
                          />
                          <span>
                            {mode === "off"
                              ? t("modelSettingsThinkingOffLabel")
                              : mode === "auto"
                                ? t("modelSettingsThinkingAutoLabel")
                                : t("modelSettingsThinkingOnLabel")}
                          </span>
                        </button>
                        {showInlineSave && renderInlineSave()}
                      </Fragment>
                    );
                  })}
                </div>
              </section>
            )}

            {processId && showEffortOptions && (
              <section className="model-switch-section">
                <div className="model-switch-section-header">
                  <strong>{t("modelSettingsEffortTitle")}</strong>
                </div>
                <div className="model-switch-chip-group">
                  {effortOptions.map((option) => {
                    const isCurrent =
                      currentThinkingMode === "on" &&
                      currentEffortLevel === option.value;
                    const isSelected =
                      effectiveThinkingMode === "on" &&
                      effectiveEffortLevel === option.value;
                    const showInlineSave =
                      dirty && lastTouchedSection === "effort" && isSelected;
                    return (
                      <Fragment key={option.value}>
                        <button
                          type="button"
                          className={`model-switch-chip ${isCurrent ? "current" : ""} ${isSelected ? "active" : ""}`}
                          onClick={() => {
                            if (
                              effectiveThinkingMode !== "on" ||
                              effortLevel !== option.value
                            ) {
                              setLastTouchedSection("effort");
                            }
                            setEffortLevelState(option.value);
                            setThinkingModeState("on");
                          }}
                          disabled={switching}
                          title={option.description}
                        >
                          <span
                            className={`model-switch-indicator-dot tone-${option.value}`}
                            aria-hidden="true"
                          />
                          <span>{option.label}</span>
                        </button>
                        {showInlineSave && renderInlineSave()}
                      </Fragment>
                    );
                  })}
                </div>
              </section>
            )}

            {showServiceTierOptions && (
              <section className="model-switch-section">
                <div className="model-switch-section-header">
                  <strong>{t("modelSwitchSpeedLabel")}</strong>
                </div>
                <div className="model-switch-chip-group">
                  {[
                    {
                      id: null,
                      name: t("serviceTierStandardLabel"),
                      description: t("serviceTierStandardDescription"),
                    },
                    ...serviceTierOptions,
                  ].map((tier) => {
                    const isCurrent = currentServiceTier === tier.id;
                    return (
                      <button
                        key={tier.id ?? "standard"}
                        type="button"
                        className={`model-switch-chip ${isCurrent ? "current active" : ""}`}
                        aria-pressed={isCurrent}
                        onClick={() => void applyServiceTier(tier.id)}
                        disabled={switching || savingServiceTier}
                        title={tier.description}
                      >
                        <span>{tier.name}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="model-switch-section-note">
                  {t("modelSwitchSpeedLiveHint")}
                </div>
              </section>
            )}

            {processId && !error && models.length === 0 && (
              <div className="model-switch-loading">
                {t("modelSwitchEmpty")}
              </div>
            )}

            {models.length > 0 && (
              <section className="model-switch-section">
                <div className="model-switch-section-header">
                  <strong>{t("newSessionModelTitle")}</strong>
                </div>
                <div className="model-switch-list">
                  {models.map((model, index) => {
                    const isCurrent = currentModelId === model.id;
                    const isSelected = selectedModel === model.id;
                    const showInlineSave =
                      dirty && lastTouchedSection === "model" && isSelected;
                    return (
                      <Fragment key={model.id}>
                        {startsAdditionalModelGroup(models, index) && (
                          <div className="model-switch-group-label">
                            {t("previousModelsGroup")}
                          </div>
                        )}
                        <div className="model-switch-item-row">
                          <button
                            type="button"
                            className={`model-switch-item ${isCurrent ? "current" : ""} ${isSelected ? "active" : ""}`}
                            onClick={() => {
                              if (selectedModel !== model.id) {
                                setLastTouchedSection("model");
                              }
                              setSelectedModel(model.id);
                            }}
                            disabled={switching}
                          >
                            <span className="model-switch-item-main">
                              <span className="model-switch-name-row">
                                <span className="model-switch-name">
                                  {model.name}
                                </span>
                                {provider && (
                                  <ProviderBadge
                                    provider={provider}
                                    model={model.id}
                                  />
                                )}
                              </span>
                              {model.description && (
                                <span className="model-switch-description">
                                  {model.description}
                                </span>
                              )}
                            </span>
                            <span className="model-switch-item-meta">
                              <ModelSubscriptionUsage
                                usage={subscriptionUsage}
                                modelId={model.id}
                              />
                              {isCurrent && (
                                <span className="model-switch-tag">
                                  {t("modelSwitchCurrent")}
                                </span>
                              )}
                              <span
                                className={`model-switch-radio ${isSelected ? "selected" : ""}`}
                                aria-hidden="true"
                              >
                                {isSelected ? "●" : "○"}
                              </span>
                            </span>
                          </button>
                          {showInlineSave && renderInlineSave()}
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              </section>
            )}

            {dirty && (
              <div className="model-switch-actions">
                <button
                  type="button"
                  className="settings-button settings-button-secondary model-switch-action-button"
                  onClick={handleDismiss}
                >
                  <span className="model-switch-action-label">
                    {t("modalCancel")}
                  </span>
                  {renderConfigBadge(
                    currentModelId ?? currentModel,
                    currentThinkingMode,
                    currentEffortLevel,
                    currentIndicatorTone,
                  )}
                </button>
                <button
                  type="button"
                  className="settings-button model-switch-action-button"
                  onClick={() => void applyConfig()}
                  disabled={switching || !selectedModel}
                >
                  <span className="model-switch-action-label">
                    {t("modelSwitchSaveAll")}
                  </span>
                  {renderConfigBadge(
                    selectedModel ?? currentModelId ?? currentModel,
                    effectiveThinkingMode,
                    effectiveEffortLevel,
                    pendingIndicatorTone,
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
