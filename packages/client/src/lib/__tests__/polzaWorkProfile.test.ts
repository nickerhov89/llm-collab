import { describe, expect, it } from "vitest";
import {
  defaultWorkProfile,
  inferWorkRole,
  parseTaskPriority,
  readWorkProfile,
  workProfileBlock,
  taskPriorityScore,
  type TaskPriority,
} from "../polzaWorkProfile";
const task: TaskPriority = {
  kpi: "renewalRevenue",
  impact: 3,
  hours: 4,
  due: "",
  blocked: false,
  reason: "Renew the assigned client's contract",
};
describe("business profiles and task prioritization", () => {
  it("maps requested role metrics without invented targets", () => {
    expect(defaultWorkProfile("sales").kpis.map((k) => k.id)).toEqual([
      "newRevenue",
      "renewalRevenue",
    ]);
    expect(defaultWorkProfile("specialist").kpis.map((k) => k.id)).toEqual([
      "renewalRevenue",
    ]);
    expect(defaultWorkProfile("marketing").kpis.map((k) => k.id)).toEqual([
      "qualifiedLeads",
    ]);
    for (const role of ["director", "admin"] as const)
      expect(defaultWorkProfile(role).kpis.map((k) => k.id)).toEqual([
        "revenue",
        "margin",
      ]);
    expect(defaultWorkProfile("sales").kpis.every((k) => k.target === "")).toBe(
      true,
    );
  });
  it("round trips a profile among other instructions and rejects a malformed replacement", () => {
    const profile = defaultWorkProfile("specialist");
    profile.kpis[0]!.target = "500000 RUB";
    expect(
      readWorkProfile([
        "Keep existing instructions",
        workProfileBlock(profile),
      ]),
    ).toEqual(profile);
    expect(
      readWorkProfile([
        workProfileBlock({
          ...profile,
          kpis: [{ id: "renewalRevenue", weight: 99, target: "" }],
        }),
      ]),
    ).toBeNull();
    expect(inferWorkRole("sales-vova")).toBe("sales");
    expect(inferWorkRole("ceo")).toBe("director");
    expect(inferWorkRole("sales-director")).toBeNull();
    expect(inferWorkRole("unknown-person")).toBeNull();
  });
  it("uses the acting person's KPI weights and requires an impact rationale", () => {
    const profile = defaultWorkProfile("sales");
    expect(taskPriorityScore(task, profile, "2026-11-12")).toBe(4.5);
    profile.kpis[1]!.weight = 5;
    expect(taskPriorityScore(task, profile, "2026-11-12")).toBe(7.5);
    expect(
      taskPriorityScore(task, defaultWorkProfile("marketing"), "2026-11-12"),
    ).toBeNull();
    expect(
      taskPriorityScore({ ...task, reason: " " }, profile, "2026-11-12"),
    ).toBeNull();
    expect(
      taskPriorityScore({ ...task, blocked: true }, profile, "2026-11-12"),
    ).toBeNull();
  });
  it("handles urgency at date boundaries without favoring large effort", () => {
    const p = defaultWorkProfile("specialist");
    expect(
      taskPriorityScore({ ...task, due: "2026-11-12" }, p, "2026-11-12"),
    ).toBe(16.5);
    expect(
      taskPriorityScore({ ...task, due: "2026-11-15" }, p, "2026-11-12"),
    ).toBe(10.5);
    expect(
      taskPriorityScore({ ...task, due: "2026-11-19" }, p, "2026-11-12"),
    ).toBe(7.5);
    expect(
      taskPriorityScore({ ...task, due: "2026-11-20" }, p, "2026-11-12"),
    ).toBe(4.5);
    expect(taskPriorityScore({ ...task, hours: 1 }, p, "2026-11-12")).toBe(9);
  });
  it("preserves assessments across JSON backups and drops invalid assessment metadata", () => {
    expect(parseTaskPriority(JSON.parse(JSON.stringify(task)))).toEqual(task);
    for (const bad of [
      { ...task, hours: 0 },
      { ...task, due: "2026-02-31" },
      { ...task, hours: Infinity },
      { ...task, impact: 20 },
      { ...task, kpi: "invented" },
    ])
      expect(parseTaskPriority(bad)).toBeUndefined();
  });
});
