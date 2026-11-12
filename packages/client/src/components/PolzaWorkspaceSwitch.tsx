import { Link, useLocation } from "react-router-dom";
import { useComposerHistoryScope } from "../hooks/useComposerHistoryScope";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useI18n } from "../i18n";
import styles from "./PolzaWorkspaceSwitch.module.css";

export function PolzaWorkspaceSwitch({ tasker = false }: { tasker?: boolean }) {
  const base = useRemoteBasePath();
  const scope = useComposerHistoryScope();
  const location = useLocation();
  const { t } = useI18n();
  const key = `polza-cowork-return:${scope}`;
  let back = `${base}/new-session`;
  try {
    const saved = sessionStorage.getItem(key);
    if (
      saved?.startsWith(`${base}/`) &&
      !saved.startsWith("//") &&
      !saved.includes("/tasker")
    )
      back = saved;
  } catch {
    /* Browser storage may be unavailable. */
  }
  return (
    <details
      className={styles.root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.currentTarget.open = false;
      }}
    >
      <summary
        className={styles.trigger}
        aria-label={t("taskerSwitchWorkspace")}
      >
        Polza {tasker ? "Tasker" : "Cowork"}
        <span aria-hidden="true">⌄</span>
      </summary>
      <nav className={styles.menu} aria-label={t("taskerSwitchWorkspace")}>
        <Link to={back} aria-current={!tasker ? "page" : undefined}>
          Cowork <span>{!tasker ? "✓" : ""}</span>
        </Link>
        <Link
          to={`${base}/tasker`}
          aria-current={tasker ? "page" : undefined}
          onClick={() => {
            if (!tasker && scope)
              try {
                sessionStorage.setItem(
                  key,
                  location.pathname + location.search + location.hash,
                );
              } catch {
                /* Navigation still works. */
              }
          }}
        >
          Tasker <span>{tasker ? "✓" : ""}</span>
        </Link>
      </nav>
    </details>
  );
}
