export const MODES = ["once", "schedule", "goal"];
const activeStates = new Set(["dispatching", "queued", "running"]);
export const isActiveRun = (run) => activeStates.has(run.status);
export function validateConfig(raw) {
  if (!raw || !MODES.includes(raw.mode)) throw Error("Invalid execution mode");
  if (
    typeof raw.projectId !== "string" ||
    !/^[A-Za-z0-9_-]{1,1024}$/.test(raw.projectId)
  )
    throw Error("Choose a project");
  if (
    typeof raw.sessionId !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(raw.sessionId)
  )
    throw Error("Choose a chat");
  const number = (v, fallback, max) => {
    const n = v ?? fallback;
    if (!Number.isInteger(n) || n < 1 || n > max)
      throw Error("Invalid execution limit");
    return n;
  };
  const timezone = raw.timezone ?? "Europe/Moscow";
  new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  const config = {
    mode: raw.mode,
    projectId: raw.projectId,
    sessionId: raw.sessionId,
    dailyLimit: number(raw.dailyLimit, 3, 24),
    pendingLimit: number(raw.pendingLimit, 3, 3),
    target: number(raw.target, 1, 100),
    criteria: String(raw.criteria ?? "")
      .trim()
      .slice(0, 4000),
    timezone,
    cadence: raw.cadence ?? "daily",
    time: raw.time ?? "09:00",
    ...(raw.intervalMinutes !== undefined
      ? { intervalMinutes: number(raw.intervalMinutes, 60, 10080) }
      : {}),
    ...(raw.weekdays !== undefined ? { weekdays: raw.weekdays } : {}),
  };
  if (
    !["interval", "hourly", "daily", "weekdays", "weekly"].includes(
      config.cadence,
    )
  )
    throw Error("Invalid schedule");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(config.time))
    throw Error("Invalid schedule time");
  if (config.cadence === "interval" && !config.intervalMinutes)
    throw Error("Choose a repeat interval");
  if (
    config.weekdays !== undefined &&
    (!Array.isArray(config.weekdays) ||
      !config.weekdays.length ||
      config.weekdays.length > 7 ||
      config.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
      new Set(config.weekdays).size !== config.weekdays.length)
  )
    throw Error("Choose valid weekdays");
  if (config.mode === "goal" && !config.criteria)
    throw Error("Describe the expected result");
  return config;
}
function parts(at, timezone) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  return Object.fromEntries(
    p.filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]),
  );
}
export function dayKey(at, timezone) {
  const p = parts(at, timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
/** One occurrence per local calendar day; nonexistent DST times are skipped. */
export function nextDue(config, after) {
  if (config.cadence === "interval")
    return after + config.intervalMinutes * 60000;
  if (config.cadence === "hourly") return after + 3600000;
  const p = parts(after, config.timezone);
  const start = Date.UTC(p.year, p.month - 1, p.day);
  const [hour, minute] = config.time.split(":").map(Number);
  for (let i = 0; i < 9; i++) {
    const day = new Date(start + i * 86400000);
    const weekday = day.getUTCDay();
    if (config.cadence === "weekdays" && [0, 6].includes(weekday)) continue;
    if (
      config.cadence === "weekly" &&
      !(config.weekdays ?? [1]).includes(weekday)
    )
      continue;
    const wall = day.getTime() + (hour * 60 + minute) * 60000;
    let utc = wall;
    for (let pass = 0; pass < 3; pass++) {
      const local = parts(utc, config.timezone);
      const represented = Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
        local.second,
      );
      utc += wall - represented;
    }
    const actual = parts(utc, config.timezone);
    if (
      utc > after &&
      actual.hour === hour &&
      actual.minute === minute &&
      dayKey(utc, config.timezone) === day.toISOString().slice(0, 10)
    )
      return utc;
  }
  throw Error("No next schedule occurrence");
}
export function instruction(task, job, run) {
  if (job.subject === "chat")
    return `${job.prompt}\n\nTasker execution ${run.id}. This is the scheduled continuation of this same chat. Return the result and evidence in this chat. Articles and editorial submissions still require the owner's approval of final text and destinations. If blocked or awaiting user input, explain it and stop.`;
  const base = `${task.title}${task.note ? `\n\n${task.note}` : ""}`;
  if (job.config.mode === "once")
    return `${base}\n\nTasker execution ${run.id}. Return the finished result with evidence for human review. Do not publish articles or send them to editors before the owner approves the final text and destinations.`;
  return `${base}\n\nTasker execution ${run.id}. Complete one useful result in this run. Do not repeat results already prepared in this chat or project; consult the plan and available source evidence. Previously approved results: ${job.approved}/${job.config.target}. ${job.config.criteria ? `Acceptance criteria: ${job.config.criteria}.` : ""}\nReturn the finished result and evidence for human review. Do not claim completion without evidence. Do not publish articles or send them to editors: the owner must approve the final text and destinations first. If blocked or awaiting approval, explain the blocker and stop this run.`;
}
