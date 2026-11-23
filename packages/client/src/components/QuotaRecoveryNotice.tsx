import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { QuotaRecoveryStatus } from "@yep-anywhere/shared";
import { api } from "../api/client";
import { activityBus } from "../lib/activityBus";
import { useI18n } from "../i18n";
import styles from "./QuotaRecoveryNotice.module.css";

export function QuotaRecoveryNotice({
  sessionId,
  projectId,
  basePath = "",
}: {
  sessionId: string;
  projectId: string;
  basePath?: string;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<QuotaRecoveryStatus>();
  useEffect(() => {
    let closed = false;
    let generation = 0;
    setState(undefined);
    const off = activityBus.on("session-metadata-changed", (event) => {
      if (event.sessionId !== sessionId || !event.quotaRecovery) return;
      generation++;
      setState(event.quotaRecovery);
    });
    const initial = generation;
    void api
      .getSessionMetadata(projectId, sessionId)
      .then((value) => {
        if (!closed && initial === generation) setState(value.quotaRecovery);
      })
      .catch(() => {});
    return () => {
      closed = true;
      off();
    };
  }, [sessionId, projectId]);
  if (!state) return null;
  return (
    <div className={styles.notice} role="status">
      <span>
        {state.status === "started"
          ? t("quotaRecoveryStarted", { provider: state.target ?? "" })
          : state.status === "blocked"
            ? t("quotaRecoveryBlocked")
            : t("quotaRecoveryPending")}
      </span>
      {state.status === "blocked" && state.reason && (
        <small>{state.reason}</small>
      )}
      {state.successorSessionId && (
        <Link
          to={`${basePath}/projects/${projectId}/sessions/${state.successorSessionId}`}
        >
          {t("quotaRecoveryOpen")}
        </Link>
      )}
    </div>
  );
}
