import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PolzaTaskPriority } from "../components/PolzaTaskPriority";
import { usePolzaWorkProfile } from "../hooks/usePolzaWorkProfile";
import {
  parseTaskPriority,
  taskPriorityScore,
  type TaskPriority,
} from "../lib/polzaWorkProfile";
import { PolzaWorkspaceSwitch } from "../components/PolzaWorkspaceSwitch";
import { useComposerHistoryScope } from "../hooks/useComposerHistoryScope";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useClientSummarySourceKey } from "../lib/clientSummarySourceKey";
import { setNewSessionPrefill } from "../lib/newSessionPrefill";
import { useI18n } from "../i18n";
import styles from "./PolzaTaskerPage.module.css";

interface Task {
  deleted?: boolean;
  priority?: TaskPriority;
  id: string;
  title: string;
  note: string;
  done: boolean;
  today: boolean;
  group: string;
}
interface Profile {
  level: number;
  xp: number;
  maxXp: number;
  hp: number;
  maxHp: number;
  gold: number;
}
interface TaskerData {
  version: 1;
  tasks: Task[];
  profile?: Profile;
}
const empty: TaskerData = { version: 1, tasks: [] };
function parseData(raw: string): TaskerData {
  const value = JSON.parse(raw);
  if (
    value?.version !== 1 ||
    !Array.isArray(value.tasks) ||
    value.tasks.length > 5000
  )
    throw new Error("invalid");
  const ids = new Set<string>();
  const tasks = value.tasks.map((item: unknown): Task => {
    if (!item || typeof item !== "object") throw new Error("invalid");
    const task = item as Partial<Task>;
    if (
      typeof task.id !== "string" ||
      !task.id ||
      ids.has(task.id) ||
      typeof task.title !== "string" ||
      !task.title.trim() ||
      task.title.length > 2000
    )
      throw new Error("invalid");
    ids.add(task.id);
    return {
      id: task.id,
      title: task.title,
      note: typeof task.note === "string" ? task.note.slice(0, 50000) : "",
      group: typeof task.group === "string" ? task.group.slice(0, 100) : "",
      deleted: task.deleted === true,
      priority: parseTaskPriority(task.priority),
      done: task.done === true,
      today: task.today === true,
    };
  });
  const profile = value.profile;
  const validProfile =
    profile &&
    ["level", "xp", "maxXp", "hp", "maxHp", "gold"].every(
      (key) =>
        typeof profile[key] === "number" &&
        Number.isFinite(profile[key]) &&
        profile[key] >= 0,
    );
  return { version: 1, tasks, ...(validProfile ? { profile } : {}) };
}

export function PolzaTaskerPage() {
  const scope = useComposerHistoryScope();
  const { t } = useI18n();
  return scope ? (
    <TaskerWorkspace key={scope} storageKey={`polza-tasker-v1:${scope}`} />
  ) : (
    <div className={styles.loading}>{t("taskerLoading")}</div>
  );
}

function TaskerWorkspace({ storageKey }: { storageKey: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const base = useRemoteBasePath();
  const source = useClientSummarySourceKey();
  const { profile: workProfile } = usePolzaWorkProfile();
  const [loadError, setLoadError] = useState(false);
  const [data, setData] = useState<TaskerData>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? parseData(saved) : empty;
    } catch {
      return empty;
    }
  });
  const [status, setStatus] = useState("");
  const [lastDeletedId, setLastDeletedId] = useState<string | null>(null);
  const [view, setView] = useState(() =>
    data.tasks.some((item) => item.today && !item.done && !item.deleted)
      ? "today"
      : "all",
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) parseData(raw);
    } catch {
      setLoadError(true);
      setStatus(t("taskerStorageError"));
    }
  }, [storageKey, t]);
  function persist(next: TaskerData) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setLoadError(false);
      return true;
    } catch {
      setLoadError(true);
      setStatus(t("taskerStorageError"));
      return false;
    }
  }
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        try {
          localStorage.setItem(storageKey, JSON.stringify(dataRef.current));
        } catch {
          /* Visible save errors are reported during edits. */
        }
      }
    };
    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
    };
  }, [storageKey]);
  function update(next: TaskerData, delayed = false) {
    if (loadError) return;
    dataRef.current = next;
    setData(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (delayed)
      saveTimer.current = setTimeout(() => {
        persist(dataRef.current);
        saveTimer.current = null;
      }, 250);
    else persist(next);
  }
  function patch(id: string, values: Partial<Task>, delayed = false) {
    update(
      {
        ...data,
        tasks: dataRef.current.tasks.map((task) =>
          task.id === id ? { ...task, ...values } : task,
        ),
      },
      delayed,
    );
  }
  function setDeleted(id: string, deleted: boolean) {
    if (loadError) return;
    const next = {
      ...dataRef.current,
      tasks: dataRef.current.tasks.map((item) =>
        item.id === id ? { ...item, deleted } : item,
      ),
    };
    if (!persist(next)) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    dataRef.current = next;
    setData(next);
    setLastDeletedId(deleted ? id : null);
    setStatus(t(deleted ? "taskerDeleted" : "taskerRestored"));
    if (deleted) setSelected(null);
    else
      setView(next.tasks.find((item) => item.id === id)?.done ? "done" : "all");
  }
  const task = data.tasks.find((item) => item.id === selected) ?? null;
  const active = data.tasks.filter((item) => !item.done && !item.deleted);
  const groups = [
    ...new Set(
      data.tasks
        .filter((item) => !item.deleted)
        .map((item) => item.group)
        .filter(Boolean),
    ),
  ];
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const score = (item: Task) =>
    taskPriorityScore(item.priority, workProfile, today);
  const visible = data.tasks.filter((item) =>
    view === "trash"
      ? item.deleted
      : !item.deleted &&
        (view === "done"
          ? item.done
          : !item.done &&
            (view === "all" ||
              view === "priority" ||
              (view === "today" ? item.today : item.group === view))),
  );
  if (view === "priority")
    visible.sort((a, b) => (score(b) ?? -1) - (score(a) ?? -1));
  const profile = data.profile;
  async function importData(importFile: File) {
    try {
      if (importFile.size > 5000000) throw new Error("size");
      const incoming = parseData(await importFile.text());
      const existing = new Set(data.tasks.map((item) => item.id));
      const added = incoming.tasks.filter((item) => !existing.has(item.id));
      const next = {
        ...data,
        tasks: [...data.tasks, ...added],
        profile: incoming.profile ?? data.profile,
      };
      if (!persist(next)) return;
      dataRef.current = next;
      setData(next);
      setView("all");
      setStatus(t("taskerImported", { count: added.length }));
    } catch {
      setStatus(t("taskerImportError"));
    }
  }
  function exportData() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "polza-tasker.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className={`${styles.shell} polza-ui`}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <PolzaWorkspaceSwitch tasker />
        </div>
        <nav aria-label={t("taskerNavigation")}>
          {(["all", "today", "priority", "done", "trash"] as const).map(
            (name) => (
              <button
                key={name}
                type="button"
                aria-current={view === name ? "page" : undefined}
                className={styles.nav}
                onClick={() => setView(name)}
              >
                <span aria-hidden="true">
                  {name === "all"
                    ? "☷"
                    : name === "today"
                      ? "▢"
                      : name === "priority"
                        ? "↑"
                        : name === "trash"
                          ? "×"
                          : "✓"}
                </span>
                {t(
                  name === "all"
                    ? "taskerInbox"
                    : name === "today"
                      ? "taskerToday"
                      : name === "priority"
                        ? "taskerPriorityTitle"
                        : name === "trash"
                          ? "taskerTrash"
                          : "taskerCompleted",
                )}
                <small>
                  {name === "all"
                    ? active.length
                    : name === "today"
                      ? active.filter((item) => item.today).length
                      : name === "priority"
                        ? active.length
                        : name === "trash"
                          ? data.tasks.filter((item) => item.deleted).length
                          : data.tasks.filter(
                              (item) => item.done && !item.deleted,
                            ).length}
                </small>
              </button>
            ),
          )}
          {workProfile && (
            <div className={styles.workGoals}>
              <strong>{t(`workRole_${workProfile.role}`)}</strong>
              {workProfile.kpis.map((k) => (
                <p key={k.id}>
                  {t(`workKpi_${k.id}`)}
                  {k.target ? `: ${k.target} · ${workProfile.period}` : ""}
                </p>
              ))}
            </div>
          )}
          <p className={styles.caption}>{t("taskerAreas")}</p>
          <div className={styles.areaList}>
            {groups.map((group) => (
              <button
                key={group}
                type="button"
                className={styles.nav}
                aria-current={view === group ? "page" : undefined}
                onClick={() => setView(group)}
              >
                <span aria-hidden="true">◇</span>
                {group}
              </button>
            ))}
          </div>
          <select
            className={styles.mobileArea}
            aria-label={t("taskerAreas")}
            value={groups.includes(view) ? view : ""}
            onChange={(event) => setView(event.target.value || "all")}
          >
            <option value="">{t("taskerAreas")}</option>
            {groups.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </nav>
        <div className={styles.bottom}>
          {profile && (
            <>
              <div className={styles.character}>
                <span>{profile.level}</span>
                <div>
                  {t("taskerCharacter")}
                  <small>Habitica</small>
                </div>
              </div>
              <progress
                value={profile.xp}
                max={Math.max(profile.maxXp, 1)}
                aria-label={t("taskerExperience")}
              />
              <p>
                {profile.xp} / {profile.maxXp} XP
                <br />
                {profile.hp} / {profile.maxHp} HP · {profile.gold}{" "}
                {t("taskerGold")}
              </p>
            </>
          )}
          <p>{t("taskerLocalStorage")}</p>
          <div className={styles.fileActions}>
            <button type="button" onClick={() => file.current?.click()}>
              {t("taskerImport")}
            </button>
            <button type="button" onClick={exportData}>
              {t("taskerExport")}
            </button>
          </div>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label={t("taskerImport")}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) void importData(chosen);
              event.target.value = "";
            }}
          />
        </div>
      </aside>
      <main className={styles.main}>
        <header className={styles.top}>
          <span>
            {new Date().toLocaleDateString(undefined, {
              day: "numeric",
              month: "long",
            })}
          </span>
          <span className={styles.mobileSwitch}>
            <PolzaWorkspaceSwitch tasker />
          </span>
          <span className={styles.saved}>{t("taskerWorkspace")}</span>
        </header>
        <div className={styles.workspace}>
          <section className={styles.list}>
            <h1>
              {view === "all"
                ? t("taskerInbox")
                : view === "today"
                  ? t("taskerToday")
                  : view === "done"
                    ? t("taskerCompleted")
                    : view === "priority"
                      ? t("taskerPriorityTitle")
                      : view === "trash"
                        ? t("taskerTrash")
                        : view}
              <span>{visible.length}</span>
            </h1>
            {view === "priority" && (
              <div className={styles.priorityIntro}>
                {workProfile ? (
                  <>
                    <strong>{t(`workRole_${workProfile.role}`)}</strong>
                    <p>{workProfile.priorities}</p>
                    <details>
                      <summary>{t("taskerWhyOrder")}</summary>
                      <p>{t("taskerPriorityFormula")}</p>
                    </details>
                  </>
                ) : (
                  <p>{t("taskerMissingWorkProfile")}</p>
                )}
                <p>{t("taskerPriorityAssessmentHint")}</p>
                <button
                  type="button"
                  className={styles.priorityHelp}
                  disabled={!workProfile || !active.length}
                  onClick={() => {
                    if (!workProfile) return;
                    const context = {
                      profile: workProfile,
                      tasks: active.slice(0, 50).map((item) => ({
                        id: item.id,
                        title: item.title,
                        note: item.note.slice(0, 1000),
                        assessment: item.priority,
                      })),
                      totalActiveTasks: active.length,
                    };
                    setNewSessionPrefill(
                      source,
                      `Review my task priorities using this work profile. Respond in my language. Recommend three next actions and explain their KPI impact. Suggest a KPI, impact, effort and rationale for each task. Distinguish evidence from assumptions; do not invent deadlines, revenue or actual results. Suggest a way to unblock blocked tasks. A specialist's renewal KPI covers only their assigned projects. Targets are plans, not actuals. This is a review: do not modify tasks or execute external actions. Data includes the first 50 active tasks; notes are capped at 1000 characters.\n\n${JSON.stringify(context, null, 2)}`,
                    );
                    navigate(`${base}/new-session`);
                  }}
                >
                  {t("taskerPriorityHelp")}
                </button>
              </div>
            )}
            <form
              className={styles.add}
              onSubmit={(event) => {
                event.preventDefault();
                if (!newTitle.trim() || loadError) return;
                const item: Task = {
                  id: crypto.randomUUID(),
                  title: newTitle.trim(),
                  note: "",
                  done: false,
                  today: view === "today",
                  group: groups.includes(view) ? view : "",
                };
                update({ ...data, tasks: [...data.tasks, item] });
                setNewTitle("");
                setSelected(item.id);
              }}
            >
              <span aria-hidden="true">＋</span>
              <input
                aria-label={t("taskerAdd")}
                placeholder={t("taskerAdd")}
                value={newTitle}
                disabled={loadError}
                maxLength={2000}
                onChange={(event) => setNewTitle(event.target.value)}
              />
            </form>
            {visible.map((item) => (
              <div
                key={item.id}
                className={`${styles.row} ${selected === item.id ? styles.selected : ""}`}
              >
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={loadError || item.deleted}
                  aria-label={t("taskerMarkDone", { title: item.title })}
                  onChange={(event) =>
                    patch(item.id, { done: event.target.checked })
                  }
                />
                <button
                  className={styles.taskButton}
                  type="button"
                  onClick={() => setSelected(item.id)}
                >
                  <span>
                    {item.title}
                    {view === "priority" && (
                      <small className={styles.priorityReason}>
                        {item.priority?.blocked
                          ? t("taskerBlocked")
                          : score(item) !== null
                            ? `${t(`workKpi_${item.priority!.kpi!}`)} · ${score(item)} — ${item.priority!.reason}`
                            : t("taskerNotAssessed")}
                      </small>
                    )}
                  </span>
                  <small>{item.group}</small>
                </button>
              </div>
            ))}
            {!visible.length && (
              <div className={styles.empty}>
                <p>{t(!data.tasks.length ? "taskerEmpty" : "taskerNoTasks")}</p>
                {view === "today" && active.length > 0 && (
                  <button type="button" onClick={() => setView("all")}>
                    {t("taskerChooseToday")}
                  </button>
                )}
                {!data.tasks.length && (
                  <button type="button" onClick={() => file.current?.click()}>
                    {t("taskerImport")}
                  </button>
                )}
              </div>
            )}
            <p className={styles.status} role="status">
              {status}
              {lastDeletedId && (
                <button
                  className={styles.undo}
                  type="button"
                  disabled={loadError}
                  onClick={() => setDeleted(lastDeletedId, false)}
                >
                  {t("taskerUndo")}
                </button>
              )}
            </p>
          </section>
          <aside
            className={styles.detail}
            data-selected={task ? "true" : "false"}
          >
            {task ? (
              <>
                <button
                  className={styles.back}
                  type="button"
                  onClick={() => setSelected(null)}
                >
                  ← {t("taskerBackToTasks")}
                </button>
                <div className={styles.detailCaption}>{t("taskerTask")}</div>
                <h2>{task.title}</h2>
                <p className={styles.group}>{task.group}</p>
                {view === "priority" && (
                  <PolzaTaskPriority
                    value={task.priority}
                    profile={workProfile}
                    disabled={loadError || task.deleted === true}
                    onChange={(priority, delayed) =>
                      patch(task.id, { priority }, delayed)
                    }
                  />
                )}
                <label className={styles.noteLabel} htmlFor="tasker-note">
                  {t("taskerContext")}
                </label>
                <textarea
                  id="tasker-note"
                  maxLength={50000}
                  value={task.note}
                  disabled={loadError || task.deleted}
                  placeholder={t("taskerContextPlaceholder")}
                  onChange={(event) =>
                    patch(task.id, { note: event.target.value }, true)
                  }
                />
                <button
                  className={styles.start}
                  disabled={task.deleted}
                  type="button"
                  onClick={() => {
                    setNewSessionPrefill(
                      source,
                      `${task.title}${task.note ? `\n\n${task.note}` : ""}`,
                    );
                    navigate(`${base}/new-session`);
                  }}
                >
                  {t("taskerStartCowork")} ↗
                </button>
                <label className={styles.option}>
                  <input
                    type="checkbox"
                    checked={task.today}
                    disabled={loadError || task.deleted}
                    onChange={(event) =>
                      patch(task.id, { today: event.target.checked })
                    }
                  />
                  {t("taskerPlanToday")}
                </label>
                <label className={styles.option}>
                  <input
                    type="checkbox"
                    checked={task.done}
                    disabled={loadError || task.deleted}
                    onChange={(event) =>
                      patch(task.id, { done: event.target.checked })
                    }
                  />
                  {t("taskerCompleted")}
                </label>
                <button
                  className={styles.deleteTask}
                  type="button"
                  disabled={loadError}
                  onClick={() => setDeleted(task.id, !task.deleted)}
                >
                  {t(task.deleted ? "taskerRestoreTask" : "taskerDeleteTask")}
                </button>
                {view !== "priority" && (
                  <PolzaTaskPriority
                    value={task.priority}
                    profile={workProfile}
                    disabled={loadError || task.deleted === true}
                    onChange={(priority, delayed) =>
                      patch(task.id, { priority }, delayed)
                    }
                  />
                )}
                <p className={styles.reward}>{t("taskerRewardNotice")}</p>
              </>
            ) : (
              <div className={styles.detailEmpty}>{t("taskerSelectTask")}</div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
