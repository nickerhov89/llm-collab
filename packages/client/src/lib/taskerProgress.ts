export interface ProgressTask {
  id: string;
  done: boolean;
  today: boolean;
  group: string;
  earnedXp?: number;
  completedAt?: string;
}
export const TASK_XP = 25;
export function withCompletion<T extends ProgressTask>(
  task: T,
  done: boolean,
  at: string,
): T {
  if (done && !task.done && !task.earnedXp)
    return { ...task, done, earnedXp: TASK_XP, completedAt: at };
  return { ...task, done };
}
export const TASKER_BADGES = [
  ["first", "✦"],
  ["four", "⚡"],
  ["ten", "✓"],
  ["twenty", "◈"],
  ["fifty", "◆"],
  ["hundred", "🏆"],
  ["twohundred", "🚀"],
  ["fivehundred", "👑"],
  ["day3", "☀"],
  ["day5", "🔥"],
  ["day10", "☄"],
  ["streak2", "🌱"],
  ["streak3", "🌿"],
  ["streak7", "🌳"],
  ["streak14", "🌲"],
  ["streak30", "🏔"],
  ["early", "🌅"],
  ["night", "🌙"],
  ["weekend", "🪁"],
  ["areas3", "🧭"],
  ["areas5", "🌍"],
  ["planned5", "🎯"],
  ["level5", "⭐"],
  ["level10", "🌟"],
] as const;
export type BadgeId = (typeof TASKER_BADGES)[number][0];
const badgeIds = new Set<string>(TASKER_BADGES.map(([id]) => id));
export function parseBadges(value: unknown): BadgeId[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (id): id is BadgeId => typeof id === "string" && badgeIds.has(id),
          ),
        ),
      ]
    : [];
}
function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function taskerProgress(tasks: ProgressTask[]) {
  const completed = tasks.filter(
    (task) =>
      task.earnedXp === TASK_XP &&
      task.completedAt &&
      Number.isFinite(Date.parse(task.completedAt)),
  );
  const xp = completed.length * TASK_XP;
  let level = 1;
  while (xp >= 50 * level * (level + 1)) level++;
  const floor = 50 * level * (level - 1);
  const next = 50 * level * (level + 1);
  const days = new Map<string, number>();
  let early = false,
    night = false,
    weekend = false;
  for (const task of completed) {
    const date = new Date(task.completedAt!);
    const day = dayKey(date);
    days.set(day, (days.get(day) ?? 0) + 1);
    early ||= date.getHours() < 9;
    night ||= date.getHours() >= 21;
    weekend ||= [0, 6].includes(date.getDay());
  }
  let streak = 0,
    bestStreak = 0,
    previous: Date | undefined;
  for (const day of [...days.keys()].sort()) {
    const date = new Date(`${day}T12:00:00`);
    const expected = previous ? new Date(previous) : undefined;
    expected?.setDate(expected.getDate() + 1);
    streak = expected && dayKey(expected) === day ? streak + 1 : 1;
    bestStreak = Math.max(bestStreak, streak);
    previous = date;
  }
  const bestDay = Math.max(0, ...days.values());
  const areas = new Set(
    completed.map((task) => task.group.trim()).filter(Boolean),
  ).size;
  const planned = completed.filter((task) => task.today).length;
  const rules: Record<BadgeId, boolean> = {
    first: completed.length >= 1,
    four: completed.length >= 4,
    ten: completed.length >= 10,
    twenty: completed.length >= 20,
    fifty: completed.length >= 50,
    hundred: completed.length >= 100,
    twohundred: completed.length >= 200,
    fivehundred: completed.length >= 500,
    day3: bestDay >= 3,
    day5: bestDay >= 5,
    day10: bestDay >= 10,
    streak2: bestStreak >= 2,
    streak3: bestStreak >= 3,
    streak7: bestStreak >= 7,
    streak14: bestStreak >= 14,
    streak30: bestStreak >= 30,
    early,
    night,
    weekend,
    areas3: areas >= 3,
    areas5: areas >= 5,
    planned5: planned >= 5,
    level5: level >= 5,
    level10: level >= 10,
  };
  return {
    xp,
    level,
    intoLevel: xp - floor,
    needed: next - floor,
    completed: completed.length,
    badges: TASKER_BADGES.filter(([id]) => rules[id]).map(([id]) => id),
  };
}
