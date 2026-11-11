import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { hasCoarsePointer } from "../lib/deviceDetection";
import { useAttachmentAction } from "../hooks/useAttachmentAction";
import { useSourceContextMenu } from "./SourceContextMenu";
import styles from "./AttachmentButton.module.css";

interface Props {
  className: string;
  disabled: boolean;
  count: number;
  onFiles?: (kind?: "files" | "photos" | "camera") => void;
  onMemo?: () => void;
  onHide?: () => void;
  onPanel?: () => void;
  onFolder?: () => void;
  onGoal?: () => void;
  onPlan?: () => void;
  onDeepResearch?: () => void;
  planActive?: boolean;
}

function AddMenuIcon({
  kind,
}: {
  kind:
    | "file"
    | "folder"
    | "goal"
    | "plan"
    | "photos"
    | "camera"
    | "research";
}) {
  const paths = {
    camera: (
      <>
        <path d="M14 4h-4L8 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4Z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
    photos: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="m3 17 5-5 4 4 4-6 5 7" />
      </>
    ),
    file: (
      <>
        <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8l-5-5H8Z" />
        <path d="M16 3v5h5" />
      </>
    ),
    folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3V7Z" />,
    goal: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" />
      </>
    ),
    plan: (
      <>
        <path d="M9 18h6M10 21h4M8 15c-1.8-1.3-3-3-3-5a7 7 0 0 1 14 0c0 2-1.2 3.7-3 5-.6.5-1 1.1-1 2H9c0-.9-.4-1.5-1-2Z" />
      </>
    ),
    research: (
      <>
        <circle cx="10.8" cy="10.8" r="6.8" />
        <path d="m16 16 5 5" />
      </>
    ),
  };
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  );
}

/** Attach files or record an audio memo; touch and context gestures share a menu. */
export function AttachmentButton({
  className,
  disabled,
  count,
  onFiles,
  onMemo,
  onHide,
  onPanel,
  onFolder,
  onGoal,
  onPlan,
  onDeepResearch,
  planActive = false,
}: Props) {
  const { t } = useI18n();
  const polzaMenu = import.meta.env.VITE_POLZA_ADMIN_UI === "true";
  const [addOpen, setAddOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (
        !addMenuRef.current?.contains(event.target as Node) &&
        !addButtonRef.current?.contains(event.target as Node)
      )
        setAddOpen(false);
    };
    const closeEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setAddOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    const closeOnResize = () => setAddOpen(false);
    window.addEventListener("resize", closeOnResize);
    window.visualViewport?.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
      window.removeEventListener("resize", closeOnResize);
      window.visualViewport?.removeEventListener("resize", closeOnResize);
    };
  }, [addOpen]);
  const [preference] = useAttachmentAction();
  const menu = useSourceContextMenu(t, {
    menu: t("audioMemoShareMenu"),
    dismiss: t("audioMemoDismissMenu"),
    heading: t("audioMemoShareMenu"),
    touchTargets: true,
  });
  const primary = !onMemo
    ? "files"
    : preference === "auto"
      ? hasCoarsePointer()
        ? "menu"
        : "files"
      : preference;
  const actions = [
    { label: t("toolbarAttachFiles"), onSelect: () => onFiles?.() },
    ...(onMemo ? [{ label: t("audioMemoRecord"), onSelect: onMemo }] : []),
    ...(onHide
      ? [
          {
            label: t("appearanceToolbarHide"),
            onSelect: onHide,
            separatorBefore: true,
          },
        ]
      : []),
  ];
  const gestures = menu.targetProps(actions, () => {});
  const anchor = addOpen ? addButtonRef.current?.getBoundingClientRect() : null;
  return (
    <>
      <button
        ref={addButtonRef}
        {...gestures}
        onContextMenu={(event) => {
          if (onPanel && window.innerWidth >= 900 && !hasCoarsePointer()) {
            event.preventDefault();
            event.stopPropagation();
            onPanel();
          } else gestures.onContextMenu?.(event);
        }}
        type="button"
        className={`${className}${polzaMenu ? ` ${styles.trigger}` : ""}`}
        data-session-toolbar-control="attachments"
        data-session-toolbar-special-context="true"
        data-attachment-menu="true"
        disabled={disabled && !polzaMenu}
        aria-label={polzaMenu ? "Add to chat" : t("toolbarAttachFiles")}
        aria-haspopup="menu"
        aria-expanded={polzaMenu ? addOpen : undefined}
        title={
          disabled
            ? t("toolbarAttachDisabled")
            : !onMemo
              ? t("toolbarAttachFiles")
              : primary === "memo"
                ? t("audioMemoAttachTooltipFiles")
                : t("audioMemoAttachTooltip")
        }
        onClick={(event) => {
          if (polzaMenu) {
            setAddOpen((open) => !open);
            return;
          }
          if (menu.consumeLongPressClick()) return;
          const action =
            event.shiftKey && onMemo
              ? primary === "memo"
                ? "files"
                : "memo"
              : primary;
          if (action === "menu") menu.openFromButton(event, actions);
          else if (action === "memo") onMemo?.();
          else onFiles?.();
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
        {count > 0 && <span className="attach-count">{count}</span>}
      </button>
      {polzaMenu && addOpen
        ? createPortal(
            <div
              ref={addMenuRef}
              className={`polza-add-menu ${styles.menu}`}
              role="menu"
              aria-label="Add to chat"
              style={{
                position: "fixed",
                left: Math.max(
                  16,
                  Math.min(anchor?.left ?? 16, window.innerWidth - 336),
                ),
                bottom:
                  window.innerHeight -
                  (anchor?.top ?? window.innerHeight - 80) +
                  8,
                maxHeight: Math.max(
                  80,
                  (anchor?.top ?? window.innerHeight - 80) -
                    (window.visualViewport?.offsetTop ?? 0) -
                    20,
                ),
              }}
            >
              {(["camera", "photos"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  disabled={disabled || !onFiles}
                  onClick={() => {
                    setAddOpen(false);
                    onFiles?.(kind);
                  }}
                >
                  <span className={styles.icon}>
                    <AddMenuIcon kind={kind} />
                  </span>
                  {t(
                    kind === "camera" ? "attachmentCamera" : "attachmentPhotos",
                  )}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                disabled={disabled || !onFiles}
                onClick={() => {
                  setAddOpen(false);
                  onFiles?.("files");
                }}
              >
                <span className={styles.icon}>
                  <AddMenuIcon kind="file" />
                </span>{" "}
                {t("attachmentFiles")}
              </button>
              {onDeepResearch && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  onClick={() => {
                    setAddOpen(false);
                    onDeepResearch();
                  }}
                >
                  <span className={styles.icon}>
                    <AddMenuIcon kind="research" />
                  </span>
                  <span>
                    {t("attachmentDeepResearch")}
                    <small>{t("attachmentDeepResearchDescription")}</small>
                  </span>
                </button>
              )}
              {onFolder && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={disabled || !onFolder}
                  onClick={() => {
                    setAddOpen(false);
                    onFolder?.();
                  }}
                >
                  <AddMenuIcon kind="folder" /> Folder
                </button>
              )}
              {onGoal && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAddOpen(false);
                    onGoal();
                  }}
                >
                  <AddMenuIcon kind="goal" /> Goal{" "}
                  <small>Set a goal to keep pursuing</small>
                </button>
              )}
              {onPlan && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAddOpen(false);
                    onPlan();
                  }}
                >
                  <AddMenuIcon kind="plan" /> Plan mode{" "}
                  <small>
                    {planActive ? "Turn plan mode off" : "Turn plan mode on"}
                  </small>
                </button>
              )}
            </div>,
            document.querySelector(".polza-ui") ?? document.body,
          )
        : null}
      {!polzaMenu && menu.menu}
    </>
  );
}
