import { useCallback, useEffect, useRef, useState } from "react";
import {
  readInventoryGoalDetails,
  type SlashCommand,
} from "@yep-anywhere/shared";
import { fetchJSON } from "../api/client";
import { useI18n } from "../i18n";
import { PolzaTaskAutomation, type Job } from "./PolzaTaskAutomation";
import { Modal } from "./ui/Modal";
import styles from "./PolzaChatExecution.module.css";

interface Props {
  projectId: string;
  sessionId: string;
  goal?: string | null;
  goalStatus?: string | null;
  running: boolean;
  onGoalCommand: (command: string) => Promise<void>;
  onActivateGoal: () => Promise<void>;
  onClose: () => void;
}
interface NativeGoal {
  objective: string | null;
  status: string | null;
  supported: boolean;
}
const endpoint = "/tasker/automation";
export function PolzaChatExecution({
  projectId,
  sessionId,
  goal,
  goalStatus,
  running,
  onGoalCommand,
  onActivateGoal,
  onClose,
}: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState("manual");
  const [objective, setObjective] = useState(goal ?? "");
  const [native, setNative] = useState<NativeGoal>({
    objective: goal ?? null,
    status: goalStatus ?? null,
    supported: goalStatus !== undefined,
  });
  const [schedule, setSchedule] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(false);
  const dirtyObjective = useRef(false);
  const identity = { subject: "chat", projectId, sessionId };
  const query = new URLSearchParams(identity).toString();
  const metadataPath = `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/metadata`;
  const readNative = useCallback(
    async (signal?: AbortSignal): Promise<NativeGoal> => {
      const metadata = await fetchJSON<{ slashCommands?: SlashCommand[] }>(
        metadataPath,
        { signal },
      );
      const details = readInventoryGoalDetails(metadata.slashCommands);
      return {
        objective: details?.goalObjective ?? null,
        status: details?.goalStatus ?? null,
        supported: details?.goalStatus !== undefined,
      };
    },
    [metadataPath],
  );
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void Promise.all([
      fetchJSON<{ job: Job | null }>(`${endpoint}?${query}`, {
        signal: controller.signal,
      }).catch(() => ({ job: null })),
      readNative(controller.signal),
    ])
      .then(([automated, current]) => {
        if (!alive.current || controller.signal.aborted) return;
        setSchedule(automated.job);
        setNative(current);
        if (!dirtyObjective.current) setObjective(current.objective ?? "");
        setMode(
          current.status === "active"
            ? "goal"
            : automated.job?.enabled
              ? "schedule"
              : "manual",
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted && alive.current)
          setError(e instanceof Error ? e.message : t("chatExecutionFailed"));
      })
      .finally(() => {
        if (!controller.signal.aborted && alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [query, readNative, t]);

  useEffect(() => {
    if (goalStatus !== undefined)
      setNative({
        objective: goal ?? null,
        status: goalStatus ?? null,
        supported: true,
      });
  }, [goal, goalStatus]);

  async function confirmed(
    command: string,
    expected: (g: NativeGoal) => boolean,
  ) {
    await onGoalCommand(command);
    for (let attempt = 0; attempt < 10; attempt++) {
      const value = await readNative();
      if (alive.current) setNative(value);
      if (expected(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw Error(t("chatExecutionUnconfirmed"));
  }
  async function activateGoal() {
    setBusy(true);
    setError("");
    try {
      await onActivateGoal();
      const current = await readNative();
      if (alive.current) setNative(current);
      if (!current.supported) throw Error(t("chatExecutionGoalUnavailable"));
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : t("chatExecutionFailed"));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function pauseSchedule() {
    const reply = await fetchJSON<{ job: Job | null }>(`${endpoint}?${query}`);
    if (!reply.job) return;
    const paused = await fetchJSON<{ job: Job }>(endpoint, {
      method: "POST",
      body: JSON.stringify({
        ...identity,
        operation: "pause",
        revision: reply.job.revision,
      }),
    });
    if (alive.current) setSchedule(paused.job);
  }
  async function beforeSchedule() {
    const current = await readNative();
    if (current.status === "active")
      await confirmed("/goal pause", (v) => v.status !== "active");
  }
  async function control(
    action: "start" | "pause" | "resume" | "clear" | "manual",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "manual") {
        await pauseSchedule();
        const current = await readNative();
        if (current.status === "active")
          await confirmed("/goal pause", (v) => v.status !== "active");
        if (alive.current) setNotice(t("chatExecutionManualSaved"));
      } else if (action === "start") {
        const text = objective.trim();
        if (
          !text ||
          /^(clear|pause|resume|edit|stop|off|reset|none|cancel)$/i.test(text)
        )
          throw Error(t("chatExecutionDescribeGoal"));
        await pauseSchedule();
        const before = await readNative();
        if (before.objective === text && before.status === "complete")
          await confirmed("/goal clear", (v) => !v.objective);
        const after = await confirmed(
          before.objective === text &&
            before.status !== "complete" &&
            before.status !== "active"
            ? "/goal resume"
            : `/goal ${text}`,
          (v) => v.objective === text && v.status !== null,
        );
        if (!["active", "complete"].includes(after.status ?? ""))
          throw Error(t("chatExecutionGoalStopped"));
        if (alive.current)
          setNotice(
            t(
              after.status === "complete"
                ? "chatExecutionGoalComplete"
                : "chatExecutionGoalStarted",
            ),
          );
      } else if (action === "resume") {
        await pauseSchedule();
        await confirmed(
          "/goal resume",
          (v) => v.status === "active" || v.status === "complete",
        );
      } else if (action === "clear") {
        await confirmed("/goal clear", (v) => !v.objective);
      } else await confirmed("/goal pause", (v) => v.status !== "active");
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : t("chatExecutionFailed"));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal title={t("chatExecutionTitle")} onClose={onClose} closeOnBackGesture>
      <div className={styles.body} data-chat-execution="true">
        <p className={styles.help}>{t("chatExecutionHelp")}</p>
        <label>
          {t("automationMode")}
          <select
            aria-label={t("chatExecutionTitle")}
            value={mode}
            disabled={loading || busy}
            onChange={(e) => {
              setMode(e.target.value);
              setError("");
              setNotice("");
            }}
          >
            <option value="manual">{t("chatExecutionManual")}</option>
            <option value="goal">Goal — {t("automationGoal")}</option>
            <option value="schedule">{t("automationSchedule")}</option>
          </select>
        </label>
        {loading && <p role="status">{t("chatExecutionLoading")}</p>}
        {mode === "manual" && (
          <>
            <p className={styles.help}>{t("chatExecutionManualHelp")}</p>
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => void control("manual")}
            >
              {t("chatExecutionDisable")}
            </button>
          </>
        )}
        {mode === "goal" && (
          <>
            <p className={styles.help}>{t("chatExecutionGoalHelp")}</p>
            {!native.supported && !loading && (
              <div>
                <p role="status">{t("chatExecutionGoalUnavailable")}</p>
                <button
                  type="button"
                  disabled={busy || running}
                  onClick={() => void activateGoal()}
                >
                  {t("chatExecutionActivate")}
                </button>
              </div>
            )}
            <label>
              {t("chatExecutionObjective")}
              <textarea
                aria-label={t("chatExecutionObjective")}
                maxLength={4000}
                value={objective}
                disabled={busy}
                onChange={(e) => {
                  dirtyObjective.current = true;
                  setObjective(e.target.value);
                }}
              />
            </label>
            <div className={styles.actions}>
              <button
                type="button"
                disabled={
                  busy ||
                  loading ||
                  !native.supported ||
                  running ||
                  !objective.trim()
                }
                onClick={() => void control("start")}
              >
                {t("chatExecutionStartGoal")}
              </button>
              {native.objective && native.status === "active" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void control("pause")}
                >
                  {t("automationPause")}
                </button>
              )}
              {native.objective &&
                native.status !== "active" &&
                native.status !== "complete" && (
                  <button
                    type="button"
                    disabled={busy || running}
                    onClick={() => void control("resume")}
                  >
                    {t("chatExecutionResumeGoal")}
                  </button>
                )}
              {native.objective && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void control("clear")}
                >
                  {t("chatExecutionClearGoal")}
                </button>
              )}
            </div>
            {running && (
              <p className={styles.help}>{t("chatExecutionRunningHelp")}</p>
            )}
          </>
        )}
        {mode === "schedule" && (
          <>
            <p className={styles.help}>{t("chatExecutionScheduleHelp")}</p>
            <PolzaTaskAutomation
              taskId={`chat:${sessionId}`}
              chat={{ projectId, sessionId }}
              disabled={busy || loading}
              onJobChange={setSchedule}
              onBeforeEnable={beforeSchedule}
            />
          </>
        )}
        <div className={styles.status} aria-live="polite">
          {native.objective && (
            <span>
              {t("chatExecutionNativeStatus")}:{" "}
              {native.status ?? t("chatExecutionNoGoal")} · {native.objective}
            </span>
          )}
          {mode !== "schedule" && (
            <span>
              {t("chatExecutionScheduleStatus")}:{" "}
              {t(schedule?.enabled ? "automationEnabled" : "automationPaused")}
            </span>
          )}
          {mode !== "schedule" && schedule?.enabled && schedule.nextAt && (
            <span>
              {t("automationNext")}:{" "}
              {new Date(schedule.nextAt).toLocaleString(undefined, {
                timeZone: schedule.config.timezone,
              })}{" "}
              · {schedule.config.timezone}
            </span>
          )}
        </div>
        {notice && (
          <p role="status">
            {notice === t("chatExecutionGoalStarted") &&
            native.status === "complete"
              ? t("chatExecutionGoalComplete")
              : notice}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
