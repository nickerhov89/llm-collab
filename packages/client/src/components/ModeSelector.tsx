import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useI18n } from "../i18n";
import { getPermissionModeOptions } from "../lib/permissionModes";
import type { PermissionMode } from "../types";
import styles from "./ModeSelector.module.css";

interface ModeSelectorProps {
  mode: PermissionMode;
  onModeChange: (mode: PermissionMode) => void;
  modes?: readonly PermissionMode[];
  disabled?: boolean;
  /** Whether permission mode changes are deferred until the next user turn. */
  changesApplyNextTurn?: boolean;
  /** Whether the selected mode has not reached a provider turn boundary yet. */
  modeChangePending?: boolean;
}

/**
 * Mode selector button that opens an anchored dropdown above the button.
 * Clicking outside the popup or selecting a mode closes it.
 */
export function ModeSelector({
  mode,
  onModeChange,
  modes,
  disabled,
  changesApplyNextTurn = false,
  modeChangePending = false,
}: ModeSelectorProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const handleButtonClick = () => {
    if (!disabled) {
      // Blur button to remove focus ring before sheet appears
      buttonRef.current?.blur();
      setIsOpen(true);
    }
  };

  const handleModeSelect = (
    selectedMode: PermissionMode,
    e?: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    e?.preventDefault();
    e?.stopPropagation();
    onModeChange(selectedMode);
    setIsOpen(false);
  };

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, handleClose]);

  // Close on click outside.
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        sheetRef.current &&
        !sheetRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        handleClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, handleClose]);

  // Focus the sheet when opened for accessibility
  useEffect(() => {
    if (isOpen) {
      sheetRef.current?.focus();
    }
  }, [isOpen]);

  const modeLabels: Record<PermissionMode, string> = {
    default: t("modeDefaultLabel" as never),
    acceptEdits: t("modeAcceptEditsLabel" as never),
    plan: t("modePlanLabel" as never),
    bypassPermissions: t("modeBypassPermissionsLabel" as never),
    auto: t("modeAutoLabel" as never),
  };
  const modeOptions = modes ?? getPermissionModeOptions({ currentMode: mode });
  const polzaMode = import.meta.env.VITE_POLZA_ADMIN_UI === "true";
  const polzaOptions = modeOptions.filter(
    (option) =>
      option === "default" ||
      option === "bypassPermissions" ||
      option === "auto" ||
      (option === "acceptEdits" && !modeOptions.includes("auto")) ||
      option === mode,
  );
  const polzaLabels: Record<PermissionMode, string> = {
    default: "Ask for approval",
    acceptEdits: "Approve edits",
    plan: "Plan",
    bypassPermissions: "Full access",
    auto: "Approve for me",
  };
  const polzaDescriptions: Record<PermissionMode, string> = {
    default: "Ask for access outside the workspace and to the internet",
    acceptEdits: "Approve workspace edits; ask for restricted actions",
    plan: "Plan before making changes",
    bypassPermissions: "Unrestricted access to this server and the internet",
    auto: "Ask only for actions detected as potentially unsafe",
  };

  const modeDescriptions: Record<PermissionMode, string> = {
    default: t("modeDefaultDescription"),
    acceptEdits: t("modeAcceptEditsDescription"),
    plan: t("modePlanDescription"),
    bypassPermissions: t("modeBypassPermissionsDescription"),
    auto: t("modeAutoDescription"),
  };
  const displayLabel = modeLabels[mode];
  const displayDotClass = `mode-${mode}`;
  const showNextTurnTiming = changesApplyNextTurn || modeChangePending;
  const buttonTitle = showNextTurnTiming
    ? `${t("modeClickToSelect" as never)} - ${t("modeNextTurnHint" as never)}`
    : t("modeClickToSelect" as never);
  const polzaIcon = (selectedMode: PermissionMode) =>
    selectedMode === "default" ? (
      <span aria-hidden="true">✋</span>
    ) : (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2.5 20 6v6.2c0 4.7-3.1 7.8-8 9.3-4.9-1.5-8-4.6-8-9.3V6l8-3.5Z" />
        {selectedMode === "bypassPermissions" ? (
          <>
            <path d="M12 7.7v5.5" />
            <circle
              cx="12"
              cy="16.7"
              r=".7"
              fill="currentColor"
              stroke="none"
            />
          </>
        ) : (
          <path d="m8.4 12.3 2.4 2.4 4.8-5" />
        )}
      </svg>
    );

  // Shared dropdown options content
  const optionsContent = (
    <>
      {showNextTurnTiming && (
        <div className="mode-selector-timing-note" role="status">
          {t("modeNextTurnHint" as never)}
        </div>
      )}

      {/* Permission mode options */}
      {(polzaMode ? polzaOptions : modeOptions).map((m) => (
        <button
          key={m}
          type="button"
          className={`mode-selector-option ${mode === m ? "selected" : ""}`}
          onClick={(e) => handleModeSelect(m, e)}
          aria-pressed={mode === m}
          aria-label={polzaMode ? polzaLabels[m] : modeLabels[m]}
        >
          {polzaMode ? (
            <span className="polza-mode-option-icon" aria-hidden="true">
              {polzaIcon(m)}
            </span>
          ) : (
            <span className={`mode-dot mode-${m}`} />
          )}
          <span className={`mode-selector-label ${styles.optionCopy}`}>
            <span>{polzaMode ? polzaLabels[m] : modeLabels[m]}</span>
            <span className={styles.description}>
              {polzaMode ? polzaDescriptions[m] : modeDescriptions[m]}
            </span>
          </span>
          {mode === m && (
            <span className="mode-selector-check" aria-hidden="true">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          )}
        </button>
      ))}
    </>
  );

  const dropdown = isOpen ? (
    <div
      ref={sheetRef}
      className={`mode-selector-dropdown ${styles.dropdown}`}
      role="dialog"
      tabIndex={-1}
      aria-label={t("modeSelectLabel" as never)}
    >
      <div className={styles.heading}>
        {polzaMode
          ? "How should ChatGPT actions be approved?"
          : t("polzaPermissionsHeading")}
      </div>
      <div className="mode-selector-options">{optionsContent}</div>
    </div>
  ) : null;

  return (
    <div className={`mode-selector-container ${styles.container}`}>
      <button
        ref={buttonRef}
        type="button"
        className={`mode-button ${styles.trigger}`}
        onClick={handleButtonClick}
        disabled={disabled}
        title={buttonTitle}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        {polzaMode ? (
          <span className="polza-mode-button-icon" aria-hidden="true">
            {polzaIcon(mode)}
          </span>
        ) : (
          <span className={`mode-dot ${displayDotClass}`} />
        )}
        <span className="mode-button-label">
          {polzaMode ? polzaLabels[mode] : displayLabel}
          {modeChangePending ? ` ${t("modePendingSuffix" as never)}` : null}
        </span>
      </button>
      {dropdown}
    </div>
  );
}
