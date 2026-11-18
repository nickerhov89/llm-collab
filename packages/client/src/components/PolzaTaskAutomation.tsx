import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchJSON } from "../api/client";
import { useProjects } from "../hooks/useProjects";
import { useI18n } from "../i18n";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import styles from "./PolzaTaskAutomation.module.css";

type Mode = "once" | "schedule" | "goal";
interface Config {
  mode: Mode;
  projectId: string;
  sessionId: string;
  cadence: string;
  time: string;
  weekdays?: number[];
  intervalMinutes?: number;
  timezone: string;
  criteria: string;
  target: number;
  dailyLimit: number;
  pendingLimit: number;
}
type RunStatus =
  | "dispatching"
  | "queued"
  | "running"
  | "completed"
  | "review"
  | "approved"
  | "rejected"
  | "unknown"
  | "dismissed"
  | "failed"
  | "cancelled"
  | "human";
interface Run {
  id: string;
  status: RunStatus;
  startedAt: number;
  projectId: string;
  sessionId: string;
  resultPreview?: string;
  hasResult?: boolean;
  resultTruncated?: boolean;
}
export interface Job {
  revision: number;
  config: Config;
  enabled: boolean;
  approved: number;
  nextAt: number | null;
  reason?: string;
  runs: Run[];
  prompt?: string;
}
interface Reply {
  available: boolean;
  job?: Job | null;
  sessions?: { id: string; title: string }[];
  text?: string;
}
const initial = (): Config => ({
  mode: "once",
  projectId: "",
  sessionId: "",
  cadence: "daily",
  time: "09:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow",
  criteria: "",
  target: 1,
  dailyLimit: 3,
  pendingLimit: 3,
});
const endpoint = "/tasker/automation";
export function PolzaTaskAutomation({
  taskId,
  disabled,
  chat,
  onJobChange,
  onBeforeEnable,
}: {
  taskId: string;
  disabled: boolean;
  chat?: { projectId: string; sessionId: string };
  onJobChange?: (job: Job | null) => void;
  onBeforeEnable?: () => Promise<void>;
}) {
  const { t } = useI18n();
  const chatSubject = Boolean(chat);
  const base = useRemoteBasePath();
  const { projects } = useProjects();
  const identity: Record<string, string> = chat
    ? { subject: "chat", projectId: chat.projectId, sessionId: chat.sessionId }
    : { taskId };
  const identityQuery = new URLSearchParams(identity).toString();
  const [config, setConfig] = useState<Config>(() =>
    chat
      ? {
          ...initial(),
          mode: "schedule",
          projectId: chat.projectId,
          sessionId: chat.sessionId,
          dailyLimit: 24,
        }
      : initial(),
  );
  const [prompt, setPrompt] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [sessions, setSessions] = useState<{ id: string; title: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const dirtyRef = useRef(false);
  const draftRevision = useRef<number | null>(null);
  const alive = useRef(false);
  const requests = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey explicitly requests a fresh server snapshot.
  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    const load = async () => {
      const sequence = ++requests.current;
      try {
        const reply = await fetchJSON<Reply>(`${endpoint}?${identityQuery}`, {
          signal: controller.signal,
        });
        if (!alive.current || sequence !== requests.current) return;
        setAvailable(reply.available);
        setJob(reply.job ?? null);
        if (reply.job && !dirtyRef.current) {
          setConfig(reply.job.config);
          setPrompt(reply.job.prompt ?? "");
        }
      } catch {
        if (alive.current && !controller.signal.aborted) setAvailable(false);
      }
    };
    void load();
    const focus = () => {
      if (!dirtyRef.current) void load();
    };
    window.addEventListener("focus", focus);
    return () => {
      controller.abort();
      window.removeEventListener("focus", focus);
    };
  }, [taskId, disabled, reloadKey, identityQuery]);
  useEffect(() => {
    if (chatSubject || !available || !config.projectId) {
      setSessions([]);
      return;
    }
    const controller = new AbortController();
    setSessions([]);
    void fetchJSON<Reply>(
      `${endpoint}?operation=context&projectId=${encodeURIComponent(config.projectId)}`,
      { signal: controller.signal },
    )
      .then((r) => {
        if (!controller.signal.aborted) setSessions(r.sessions ?? []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setProblem(t("automationContextError"));
      });
    return () => controller.abort();
  }, [available, config.projectId, t, chatSubject]);
  // Only the opened card owns this refresh; hidden/unmounted pages have no interval.
  useEffect(() => {
    if (
      !job ||
      !available ||
      !(
        job.enabled ||
        job.runs.some((r) =>
          ["queued", "running", "dispatching"].includes(r.status),
        )
      )
    )
      return;
    const controller = new AbortController();
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || inFlight || busy) return;
      inFlight = true;
      void fetchJSON<Reply>(`${endpoint}?${identityQuery}`, {
        signal: controller.signal,
      })
        .then((reply) => {
          if (!controller.signal.aborted) setJob(reply.job ?? null);
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    }, 15000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [available, busy, job, identityQuery]);
  useEffect(() => {
    onJobChange?.(job);
  }, [job, onJobChange]);
  function change(patch: Partial<Config>) {
    if (!dirtyRef.current) draftRevision.current = job?.revision ?? 0;
    setConfig((old) => ({ ...old, ...patch }));
    dirtyRef.current = true;
    setDirty(true);
  }
  async function action(operation: string, runId?: string) {
    setBusy(true);
    setProblem("");
    ++requests.current;
    try {
      if (operation === "run" || operation === "resume")
        await onBeforeEnable?.();
      const reply = await fetchJSON<Reply>(endpoint, {
        method: "POST",
        body: JSON.stringify({
          operation,
          ...identity,
          ...(chat ? { prompt } : {}),
          revision:
            operation === "save" && draftRevision.current !== null
              ? draftRevision.current
              : (job?.revision ?? 0),
          config,
          runId,
        }),
      });
      if (!alive.current) return;
      setJob(reply.job ?? null);
      setAvailable(true);
      if (operation === "save") {
        dirtyRef.current = false;
        draftRevision.current = null;
        setDirty(false);
        if (reply.job) {
          setConfig(reply.job.config);
          setPrompt(reply.job.prompt ?? "");
        }
      }
    } catch (error) {
      if (alive.current)
        setProblem(
          error instanceof Error ? error.message : t("automationError"),
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function result(runId: string) {
    try {
      const r = await fetchJSON<Reply>(
        `${endpoint}?operation=result&${identityQuery}&runId=${encodeURIComponent(runId)}`,
      );
      if (alive.current)
        setResults((old) => ({ ...old, [runId]: r.text ?? "" }));
    } catch {
      if (alive.current) setProblem(t("automationError"));
    }
  }
  const blocked = disabled || busy || !available;
  const ready = !blocked && !dirty && job;
  const waitingReview =
    !!job &&
    job.runs.some((r) => r.status === "review") &&
    (job.runs.filter((r) => r.status === "review").length >=
      job.config.pendingLimit ||
      (job.config.mode === "goal" &&
        job.approved + job.runs.filter((r) => r.status === "review").length >=
          job.config.target));
  return (
    <section
      className={styles.panel}
      data-task-automation="true"
      aria-label={t("automationTitle")}
    >
      {!chat && (
        <>
          <h3>{t("automationTitle")}</h3>
          <p className={styles.help}>{t("automationHelp")}</p>
        </>
      )}
      {chat && (
        <label>
          {t("chatExecutionPrompt")}
          <textarea
            value={prompt}
            maxLength={6000}
            disabled={blocked}
            onChange={(e) => {
              change({});
              setPrompt(e.target.value);
            }}
          />
        </label>
      )}
      {available === false && <p role="status">{t("automationUnavailable")}</p>}
      {!chat && (
        <>
          <label>
            {t("automationMode")}
            <select
              aria-label={t("automationMode")}
              value={config.mode}
              disabled={blocked}
              onChange={(e) => change({ mode: e.target.value as Mode })}
            >
              <option value="once">{t("automationOnce")}</option>
              <option value="schedule">{t("automationSchedule")}</option>
              <option value="goal">{t("automationGoal")}</option>
            </select>
          </label>
          <label>
            {t("automationProject")}
            <select
              aria-label={t("automationProject")}
              value={config.projectId}
              disabled={blocked}
              onChange={(e) =>
                change({ projectId: e.target.value, sessionId: "" })
              }
            >
              <option value="">{t("automationChooseProject")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? p.path}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("automationChat")}
            <select
              aria-label={t("automationChat")}
              value={config.sessionId}
              disabled={blocked || !config.projectId}
              onChange={(e) => change({ sessionId: e.target.value })}
            >
              <option value="">{t("automationChooseChat")}</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          {config.projectId && !sessions.length && available && (
            <p className={styles.help}>{t("automationCreateChat")}</p>
          )}
        </>
      )}
      {config.mode === "schedule" && (
        <div className={styles.grid}>
          <label>
            {t("automationCadence")}
            <select
              aria-label={t("automationCadence")}
              value={config.cadence}
              disabled={blocked}
              onChange={(e) =>
                change({
                  cadence: e.target.value,
                  ...(e.target.value === "interval"
                    ? { intervalMinutes: config.intervalMinutes ?? 60 }
                    : {}),
                })
              }
            >
              {chat && (
                <option value="interval">{t("chatExecutionInterval")}</option>
              )}
              <option value="hourly">{t("automationHourly")}</option>
              <option value="daily">{t("automationDaily")}</option>
              <option value="weekdays">{t("automationWeekdays")}</option>
              <option value="weekly">
                {t(chat ? "chatExecutionWeekly" : "automationWeekly")}
              </option>
            </select>
          </label>
          {config.cadence === "interval" && (
            <label>
              {t("chatExecutionIntervalMinutes")}
              <input
                type="number"
                min={1}
                max={10080}
                value={config.intervalMinutes ?? 60}
                disabled={blocked}
                onChange={(e) =>
                  change({ intervalMinutes: Number(e.target.value) })
                }
              />
            </label>
          )}
          {config.cadence !== "hourly" && config.cadence !== "interval" && (
            <label>
              {t("automationTime")}
              <input
                type="time"
                value={config.time}
                disabled={blocked}
                onChange={(e) => change({ time: e.target.value })}
              />
            </label>
          )}
          {chat && config.cadence === "weekly" && (
            <fieldset className={styles.wide}>
              <legend>{t("chatExecutionWeekdays")}</legend>
              <div className={styles.days}>
                {([1, 2, 3, 4, 5, 6, 0] as const).map((d) => (
                  <label key={d}>
                    <input
                      type="checkbox"
                      checked={(config.weekdays ?? [1]).includes(d)}
                      disabled={blocked}
                      onChange={(e) =>
                        change({
                          weekdays: e.target.checked
                            ? [...(config.weekdays ?? [1]), d]
                            : (config.weekdays ?? [1]).filter((v) => v !== d),
                        })
                      }
                    />
                    {t(`chatExecutionDay${d}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <label className={styles.wide}>
            {t("automationTimezone")}
            <input
              value={config.timezone}
              disabled={blocked}
              onChange={(e) => change({ timezone: e.target.value })}
            />
          </label>
        </div>
      )}
      {config.mode === "goal" && (
        <>
          <label>
            {t("automationCriteria")}
            <textarea
              value={config.criteria}
              maxLength={4000}
              disabled={blocked}
              onChange={(e) => change({ criteria: e.target.value })}
            />
          </label>
          <label>
            {t("automationTarget")}
            <input
              type="number"
              min={1}
              max={100}
              value={config.target}
              disabled={blocked}
              onChange={(e) => change({ target: Number(e.target.value) })}
            />
          </label>
          <p className={styles.help}>{t("automationGoalHelp")}</p>
        </>
      )}
      <div className={styles.grid}>
        <label>
          {t("automationDailyLimit")}
          <input
            type="number"
            min={1}
            max={24}
            value={config.dailyLimit}
            disabled={blocked}
            onChange={(e) => change({ dailyLimit: Number(e.target.value) })}
          />
        </label>
        {!chat && (
          <label>
            {t("automationPendingLimit")}
            <input
              type="number"
              min={1}
              max={3}
              value={config.pendingLimit}
              disabled={blocked}
              onChange={(e) => change({ pendingLimit: Number(e.target.value) })}
            />
          </label>
        )}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={
            blocked ||
            !config.projectId ||
            !config.sessionId ||
            (Boolean(chat) && !prompt.trim())
          }
          onClick={() => void action("save")}
        >
          {t("automationSave")}
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => void action("run")}
        >
          {t("automationRun")}
        </button>
        {job?.enabled ? (
          <button
            type="button"
            disabled={blocked}
            onClick={() => void action("pause")}
          >
            {t("automationPause")}
          </button>
        ) : (
          config.mode !== "once" && (
            <button
              type="button"
              disabled={!ready}
              onClick={() => void action("resume")}
            >
              {t("automationEnable")}
            </button>
          )
        )}
      </div>
      {job && (
        <div className={styles.summary} aria-live="polite">
          <span>
            {t(job.enabled ? "automationEnabled" : "automationPaused")}
          </span>
          {job.config.mode === "goal" && (
            <strong>
              {job.approved} / {job.config.target} {t("automationAccepted")}
            </strong>
          )}
          {job.enabled && job.nextAt && !waitingReview && (
            <span>
              {t("automationNext")}:{" "}
              {new Date(job.nextAt).toLocaleString(undefined, {
                timeZone: job.config.timezone,
              })}{" "}
              · {job.config.timezone}
            </span>
          )}
          {waitingReview && <span>{t("automationReviewToContinue")}</span>}
          {job.reason && <span>{job.reason}</span>}
        </div>
      )}
      {(dirty || problem || available === false) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            dirtyRef.current = false;
            draftRevision.current = null;
            setDirty(false);
            setProblem("");
            setReloadKey((k) => k + 1);
          }}
        >
          {t(dirty ? "automationReloadDiscard" : "automationRefresh")}
        </button>
      )}
      {problem && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}
      {!!job?.runs.length && (
        <details className={styles.history}>
          <summary>
            {t("automationHistory")} ({job.runs.length})
          </summary>
          {job.runs
            .slice()
            .reverse()
            .map((run) => (
              <article key={run.id}>
                <div>
                  <time>{new Date(run.startedAt).toLocaleString()}</time>
                  <strong>{t(`automationStatus_${run.status}`)}</strong>
                </div>
                <Link
                  to={`${base}/projects/${run.projectId}/sessions/${run.sessionId}`}
                >
                  {t("automationOpenChat")} ↗
                </Link>
                {run.resultPreview && (
                  <p className={styles.preview}>{run.resultPreview}</p>
                )}
                {run.hasResult && !results[run.id] && (
                  <button type="button" onClick={() => void result(run.id)}>
                    {t("automationReadResult")}
                  </button>
                )}
                {results[run.id] && (
                  <pre className={styles.result}>{results[run.id]}</pre>
                )}
                {run.resultTruncated && (
                  <p className={styles.help}>{t("automationFullInChat")}</p>
                )}
                {run.status === "review" && (
                  <div className={styles.actions}>
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => void action("approve", run.id)}
                    >
                      {t("automationApprove")}
                    </button>
                    <button
                      type="button"
                      disabled={blocked}
                      onClick={() => void action("reject", run.id)}
                    >
                      {t("automationReject")}
                    </button>
                  </div>
                )}
                {["human", "unknown"].includes(run.status) && (
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => void action("inspect", run.id)}
                  >
                    {t("automationInspect")}
                  </button>
                )}
                {run.status === "unknown" && (
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => void action("acknowledge", run.id)}
                  >
                    {t("automationAcknowledge")}
                  </button>
                )}
              </article>
            ))}
        </details>
      )}
    </section>
  );
}
