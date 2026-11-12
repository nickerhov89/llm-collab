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
    <nav className={styles.root} aria-label={t("taskerSwitchWorkspace")}>
      <span className={styles.active} aria-current="page">
        {tasker ? "Tasker" : "Cowork"}
      </span>
      <span className={styles.separator} aria-hidden="true">
        /
      </span>
      <Link
        className={styles.destination}
        to={tasker ? back : `${base}/tasker`}
        onClick={() => {
          if (!tasker && scope) {
            try {
              sessionStorage.setItem(
                key,
                location.pathname + location.search + location.hash,
              );
            } catch {
              /* Navigation still works when storage is unavailable. */
            }
          }
        }}
      >
        {tasker ? "Cowork" : "Tasker"}
      </Link>
    </nav>
  );
}
