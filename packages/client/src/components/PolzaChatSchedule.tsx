import {
  nextDue,
  validateConfig,
} from "../../../../scripts/polza-task-automation/model.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  readInventoryGoalDetails,
  type SlashCommand,
} from "@yep-anywhere/shared";
import { fetchJSON } from "../api/client";
import { useI18n } from "../i18n";
import type { Job } from "./PolzaTaskAutomation";
import styles from "./PolzaChatSchedule.module.css";

type Config = Job["config"];
const endpoint = "/tasker/automation";
const freshConfig = (projectId: string, sessionId: string): Config => ({
  mode: "schedule",
  projectId,
  sessionId,
  cadence: "weekdays",
  time: "09:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow",
  weekdays: [1],
  intervalMinutes: 60,
  criteria: "",
  target: 1,
  dailyLimit: 24,
  pendingLimit: 3,
});

export function usePolzaChatSchedule({
  projectId,
  sessionId,
  enabled,
  onGoalCommand,
  getDraft,
  setDraft,
}: {
  projectId: string;
  sessionId: string;
  enabled: boolean;
  onGoalCommand: (command: string) => Promise<void>;
  getDraft: () => string;
  setDraft: (text: string) => void;
}) {
  const { t } = useI18n();
  const [job, setJob] = useState<Job | null>(null);
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState(() => freshConfig(projectId, sessionId));
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const locked = useRef(false);
  const reads = useRef(0);
  const generation = useRef(0);
  const query = new URLSearchParams({
    subject: "chat",
    projectId,
    sessionId,
  }).toString();
  const read = useCallback(
    (signal?: AbortSignal) =>
      fetchJSON<{ available: boolean; job: Job | null }>(
        `${endpoint}?${query}`,
        { signal },
      ),
    [query],
  );
  useEffect(() => {
    const current = ++generation.current;
    setJob(null);
    setOpen(false);
    setError("");
    setBusy(false);
    setLoading(false);
    setReady(false);
    locked.current = false;
    if (!enabled) return;
    const controller = new AbortController();
    const refresh = () => {
      if (locked.current || document.visibilityState === "hidden") return;
      const request = ++reads.current;
      void read(controller.signal)
        .then((r) => {
          if (
            generation.current === current &&
            !controller.signal.aborted &&
            !locked.current &&
            request === reads.current
          )
            setJob(r.job);
        })
        .catch(() => {
          /* Opening the editor exposes connection failures. */
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      ++generation.current;
      controller.abort();
      window.removeEventListener("focus", refresh);
    };
  }, [enabled, read]);

  async function edit() {
    if (locked.current) return;
    const current = generation.current;
    locked.current = true;
    ++reads.current;
    setReady(false);
    setOpen(true);
    setLoading(true);
    setError("");
    try {
      const r = await read();
      if (generation.current !== current) return;
      if (!r.available) throw Error(t("automationUnavailable"));
      setReady(true);
      setJob(r.job);
      setRevision(r.job?.revision ?? 0);
      setConfig(
        r.job?.config.mode === "schedule"
          ? { ...r.job.config }
          : freshConfig(projectId, sessionId),
      );
      if (
        !getDraft().trim() &&
        r.job?.config.mode === "schedule" &&
        r.job.prompt
      )
        setDraft(r.job.prompt);
    } catch (e) {
      if (generation.current === current)
        setError(e instanceof Error ? e.message : t("automationError"));
    } finally {
      if (generation.current === current) {
        locked.current = false;
        setLoading(false);
      }
    }
  }
  async function post(operation: string, rev: number, extra = {}) {
    const r = await fetchJSON<{ job: Job }>(endpoint, {
      method: "POST",
      body: JSON.stringify({
        subject: "chat",
        projectId,
        sessionId,
        operation,
        revision: rev,
        ...extra,
      }),
    });
    return r.job;
  }
  async function pauseGoal() {
    const path = `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/metadata`;
    const inspect = async () =>
      readInventoryGoalDetails(
        (await fetchJSON<{ slashCommands?: SlashCommand[] }>(path))
          .slashCommands,
      );
    if ((await inspect())?.goalStatus !== "active") return;
    await onGoalCommand("/goal pause");
    for (let i = 0; i < 10; i++) {
      if ((await inspect())?.goalStatus !== "active") return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw Error(t("chatExecutionUnconfirmed"));
  }
  async function submit(
    prompt: string,
    hasAttachments = false,
  ): Promise<boolean> {
    if (locked.current || loading || !ready) return false;
    if (!prompt.trim() || prompt.length > 6000) {
      setError(t("schedulePromptRequired"));
      return false;
    }
    if (hasAttachments) {
      setError(t("scheduleTextOnly"));
      return false;
    }
    const current = generation.current;
    locked.current = true;
    ++reads.current;
    setBusy(true);
    setError("");
    try {
      // Save remains paused until native Goal is confirmed paused. Never run now.
      const saved = await post("save", revision, {
        config: { ...config, mode: "schedule" },
        prompt,
      });
      if (generation.current !== current) return false;
      setJob(saved);
      setRevision(saved.revision);
      await pauseGoal();
      const active = await post("resume", saved.revision);
      if (generation.current !== current) return false;
      setJob(active);
      setRevision(active.revision);
      setOpen(false);
      return true;
    } catch (e) {
      if (generation.current === current)
        setError(e instanceof Error ? e.message : t("automationError"));
      return false;
    } finally {
      if (generation.current === current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  async function control(operation: "pause" | "resume" | "remove") {
    if (!job || locked.current) return;
    const current = generation.current;
    locked.current = true;
    ++reads.current;
    setBusy(true);
    setError("");
    try {
      if (operation === "resume") await pauseGoal();
      // Removing recurrence retains occurrence receipts in the account's store.
      const next =
        operation === "remove"
          ? await post("save", job.revision, {
              config: { ...job.config, mode: "once" },
              prompt: job.prompt,
            })
          : await post(operation, job.revision);
      if (generation.current === current) {
        setJob(next);
        setRevision(next.revision);
        if (operation === "remove") setOpen(false);
      }
    } catch (e) {
      if (generation.current === current) {
        setError(e instanceof Error ? e.message : t("automationError"));
        setOpen(true);
      }
    } finally {
      if (generation.current === current) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  return {
    job,
    open,
    config,
    setConfig,
    edit,
    close: () => {
      if (!busy && !loading) setOpen(false);
    },
    submit,
    control,
    busy,
    loading,
    ready,
    error,
  };
}
export type ChatSchedule = ReturnType<typeof usePolzaChatSchedule>;
function cadenceLabel(config: Config, t: ReturnType<typeof useI18n>["t"]) {
  return config.cadence === "interval"
    ? t("scheduleEveryMinutes", { count: config.intervalMinutes ?? 60 })
    : t(
        config.cadence === "weekdays"
          ? "automationWeekdays"
          : config.cadence === "weekly"
            ? "chatExecutionWeekly"
            : config.cadence === "hourly"
              ? "automationHourly"
              : "automationDaily",
      );
}
function nextLabel(job: Job, t: ReturnType<typeof useI18n>["t"]) {
  return job.enabled && job.nextAt
    ? `${t("automationNext")}: ${new Date(job.nextAt).toLocaleString(undefined, { timeZone: job.config.timezone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${job.config.timezone}`
    : t("automationPaused");
}
export function ChatScheduleBadge({ schedule }: { schedule: ChatSchedule }) {
  const { t } = useI18n();
  const { job } = schedule;
  if (job?.config.mode !== "schedule") return null;
  return (
    <button
      type="button"
      className={styles.badge}
      data-paused={!job.enabled}
      title={nextLabel(job, t)}
      onClick={() => void schedule.edit()}
      aria-label={t("scheduleEdit")}
    >
      <Clock />{" "}
      <span>
        {cadenceLabel(job.config, t)}
        {!["hourly", "interval"].includes(job.config.cadence) &&
          ` · ${job.config.time}`}
        {!job.enabled && ` · ${t("automationPaused")}`}
      </span>
    </button>
  );
}
function Clock() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
export function ChatScheduleEditor({
  schedule,
  prompt,
  onSubmit,
}: {
  schedule: ChatSchedule;
  prompt: string;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  const { config, setConfig, job, busy, loading } = schedule;
  const blocked = busy || loading || !schedule.ready;
  const next = useMemo(() => {
    try {
      return nextDue(validateConfig(config), Date.now());
    } catch {
      return null;
    }
  }, [config]);
  const patch = (value: Partial<Config>) =>
    setConfig((c) => ({ ...c, ...value }));
  const [expanded, setExpanded] = useState(false);
  return (
    <section
      className={styles.editor}
      aria-label={t("scheduleEditor")}
      data-chat-schedule="true"
    >
      <div className={styles.row}>
        <Clock />
        <button
          type="button"
          className={styles.when}
          disabled={blocked}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {cadenceLabel(config, t)}
          {!["interval", "hourly"].includes(config.cadence) &&
            ` · ${config.time}`}{" "}
          <span className={styles.zone}>{config.timezone}</span> ⌄
        </button>
        <button
          type="button"
          className={styles.submit}
          disabled={blocked || !prompt.trim() || next === null}
          onClick={onSubmit}
        >
          {t(busy ? "scheduleSaving" : "scheduleSubmit")}
        </button>
        <button
          type="button"
          className={styles.close}
          disabled={blocked}
          aria-label={t("scheduleClose")}
          onClick={schedule.close}
        >
          ×
        </button>
      </div>
      {!loading && schedule.ready && (
        <p className={styles.preview}>
          {next
            ? `${t("scheduleFirstRun")}: ${new Date(next).toLocaleString(undefined, { timeZone: config.timezone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
            : t("scheduleInvalid")}
        </p>
      )}
      {loading && <p role="status">{t("chatExecutionLoading")}</p>}
      {expanded && (
        <div className={styles.options}>
          <label>
            {t("automationCadence")}
            <select
              aria-label={t("automationCadence")}
              disabled={blocked}
              value={config.cadence}
              onChange={(e) => patch({ cadence: e.target.value })}
            >
              <option value="daily">{t("automationDaily")}</option>
              <option value="weekdays">{t("automationWeekdays")}</option>
              <option value="weekly">{t("chatExecutionWeekly")}</option>
              <option value="hourly">{t("automationHourly")}</option>
              <option value="interval">{t("chatExecutionInterval")}</option>
            </select>
          </label>
          {config.cadence === "interval" ? (
            <label>
              {t("chatExecutionIntervalMinutes")}
              <input
                type="number"
                min="1"
                max="10080"
                disabled={blocked}
                value={config.intervalMinutes ?? 60}
                onChange={(e) =>
                  patch({ intervalMinutes: Number(e.target.value) })
                }
              />
            </label>
          ) : (
            config.cadence !== "hourly" && (
              <label>
                {t("automationTime")}
                <input
                  type="time"
                  disabled={blocked}
                  value={config.time}
                  onChange={(e) => patch({ time: e.target.value })}
                />
              </label>
            )
          )}
          {config.cadence === "weekly" && (
            <fieldset className={styles.days}>
              <legend>{t("chatExecutionWeekdays")}</legend>
              {([1, 2, 3, 4, 5, 6, 0] as const).map((d) => (
                <label key={d}>
                  <input
                    type="checkbox"
                    disabled={blocked}
                    checked={(config.weekdays ?? [1]).includes(d)}
                    onChange={(e) =>
                      patch({
                        weekdays: e.target.checked
                          ? [...(config.weekdays ?? [1]), d]
                          : (config.weekdays ?? [1]).filter((v) => v !== d),
                      })
                    }
                  />
                  {t(`chatExecutionDay${d}`)}
                </label>
              ))}
            </fieldset>
          )}
          <label className={styles.timezone}>
            {t("automationTimezone")}
            <input
              disabled={blocked}
              value={config.timezone}
              onChange={(e) => patch({ timezone: e.target.value })}
            />
          </label>
        </div>
      )}
      {job?.config.mode === "schedule" && (
        <div className={styles.existing}>
          <span>{nextLabel(job, t)}</span>
          <button
            type="button"
            disabled={blocked}
            onClick={() =>
              void schedule.control(job.enabled ? "pause" : "resume")
            }
          >
            {t(job.enabled ? "automationPause" : "automationEnable")}
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => void schedule.control("remove")}
          >
            {t("scheduleRemove")}
          </button>
        </div>
      )}
      {job?.reason && <p className={styles.reason}>{job.reason}</p>}
      {schedule.error && (
        <p role="alert" className={styles.error}>
          {schedule.error}{" "}
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => void schedule.edit()}
          >
            {t("automationRefresh")}
          </button>
        </p>
      )}
    </section>
  );
}
