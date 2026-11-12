export const WORK_ROLES = [
  "sales",
  "specialist",
  "marketing",
  "director",
  "admin",
] as const;
export type WorkRole = (typeof WORK_ROLES)[number];
export const KPI_IDS = [
  "newRevenue",
  "renewalRevenue",
  "qualifiedLeads",
  "revenue",
  "margin",
] as const;
export type KpiId = (typeof KPI_IDS)[number];
export interface WorkKpi {
  id: KpiId;
  weight: number;
  target: string;
}
export interface WorkProfile {
  role: WorkRole;
  priorities: string;
  period: string;
  kpis: WorkKpi[];
}
export const PROFILE_MARKER = "[Polza work profile v1]\n";
const roleKpis: Record<WorkRole, readonly KpiId[]> = {
  sales: ["newRevenue", "renewalRevenue"],
  specialist: ["renewalRevenue"],
  marketing: ["qualifiedLeads"],
  director: ["revenue", "margin"],
  admin: ["revenue", "margin"],
};
const priorities: Record<WorkRole, string> = {
  sales:
    "Приоритет: выручка от первичных продаж и продлений. Сначала сделки с подтверждённым следующим шагом, оплата и риск потери продления.",
  specialist:
    "Приоритет: выручка продлений по закреплённым за мной проектам. Сначала устранение рисков оттока, выполнение обещанного клиенту результата и подготовка продления.",
  marketing:
    "Приоритет: квалифицированные лиды. Оценивать лиды по согласованным критериям квалификации; не подменять их охватами, кликами или сырыми заявками.",
  director:
    "Приоритет: выручка и маржинальность. Сначала защита выручки, прибыльность проектов и устранение препятствий для команды.",
  admin:
    "Приоритет: выручка и маржинальность. Сначала задачи, которые защищают деньги, снижают затраты и устраняют препятствия для команды.",
};
export function defaultWorkProfile(role: WorkRole): WorkProfile {
  return {
    role,
    priorities: priorities[role],
    period: "Месяц",
    kpis: roleKpis[role].map((id) => ({ id, weight: 3, target: "" })),
  };
}
/** Business roles describe goals, never authorization or project grants. */
export function inferWorkRole(username: string): WorkRole | null {
  const name = username.toLowerCase();
  const patterns: [WorkRole, RegExp][] = [
    ["admin", /(?:admin|админ|owner)/u],
    ["director", /(?:director|директор|ceo|директ)/u],
    ["marketing", /(?:market|маркет|marker)/u],
    ["sales", /(?:sales|сейл|продаж|sdr|роп)/u],
    ["specialist", /(?:specialist|спец|delivery|account|аккаунт)/u],
  ];
  const matches = patterns.filter(([, pattern]) => pattern.test(name));
  return matches.length === 1 ? matches[0]![0] : null;
}
export function parseWorkProfile(value: unknown): WorkProfile | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<WorkProfile>;
  if (
    !WORK_ROLES.includes(p.role as WorkRole) ||
    typeof p.priorities !== "string" ||
    p.priorities.length > 2000 ||
    typeof p.period !== "string" ||
    p.period.length > 100 ||
    !Array.isArray(p.kpis) ||
    p.kpis.length > 5
  )
    return null;
  const seen = new Set<string>();
  for (const k of p.kpis) {
    if (
      !k ||
      !KPI_IDS.includes(k.id) ||
      seen.has(k.id) ||
      !Number.isInteger(k.weight) ||
      k.weight < 1 ||
      k.weight > 5 ||
      typeof k.target !== "string" ||
      k.target.length > 100
    )
      return null;
    seen.add(k.id);
  }
  return p as WorkProfile;
}
export function readWorkProfile(blocks: readonly string[]): WorkProfile | null {
  for (const text of blocks) {
    if (!text.startsWith(PROFILE_MARKER)) continue;
    try {
      const profile = parseWorkProfile(
        JSON.parse(text.slice(PROFILE_MARKER.length).split("\n")[0]!),
      );
      if (profile) return profile;
    } catch {
      /* Other instructions remain untouched. */
    }
  }
  return null;
}
export function workProfileBlock(profile: WorkProfile): string {
  return (
    PROFILE_MARKER +
    JSON.stringify(profile) +
    "\nUse this person's business goals and KPI weights when helping them prioritize work. Specialist renewal revenue covers only their assigned projects. Targets are plans, not actual results. Never invent actuals or count completing a task as revenue. Business role does not change permissions."
  );
}
export interface TaskPriority {
  kpi?: KpiId;
  impact: number;
  hours: number;
  due: string;
  blocked: boolean;
  reason: string;
}
export const emptyTaskPriority: TaskPriority = {
  impact: 2,
  hours: 1,
  due: "",
  blocked: false,
  reason: "",
};
export function parseTaskPriority(value: unknown): TaskPriority | undefined {
  if (!value || typeof value !== "object") return undefined;
  const p = value as Partial<TaskPriority>;
  if (
    (p.kpi !== undefined && !KPI_IDS.includes(p.kpi)) ||
    !Number.isInteger(p.impact) ||
    ![1, 2, 3].includes(p.impact!) ||
    typeof p.hours !== "number" ||
    !Number.isFinite(p.hours) ||
    p.hours < 0.25 ||
    p.hours > 1000 ||
    typeof p.due !== "string" ||
    (p.due !== "" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(p.due) ||
        !Number.isFinite(Date.parse(p.due)) ||
        new Date(p.due).toISOString().slice(0, 10) !== p.due)) ||
    typeof p.blocked !== "boolean" ||
    typeof p.reason !== "string" ||
    p.reason.length > 2000
  )
    return undefined;
  return p as TaskPriority;
}
export function taskPriorityScore(
  priority: TaskPriority | undefined,
  profile: WorkProfile | null,
  today: string,
): number | null {
  const kpi = profile?.kpis.find((k) => k.id === priority?.kpi);
  if (!priority || !kpi || !priority.reason.trim() || priority.blocked)
    return null;
  const days = priority.due
    ? (Date.parse(priority.due) - Date.parse(today)) / 86400000
    : Infinity;
  const urgency = days <= 0 ? 12 : days <= 3 ? 6 : days <= 7 ? 3 : 0;
  return (
    Math.round(
      ((priority.impact * kpi.weight) /
        Math.sqrt(Math.max(priority.hours, 0.25)) +
        urgency) *
        10,
    ) / 10
  );
}
