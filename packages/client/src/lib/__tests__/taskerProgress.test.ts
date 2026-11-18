import { describe, it, expect } from "vitest";
import {
  TASKER_BADGES,
  taskerProgress,
  withCompletion,
  type ProgressTask,
} from "../taskerProgress";
const task = (id: string): ProgressTask => ({
  id,
  done: false,
  today: false,
  group: "",
});
describe("Tasker completion ledger", () => {
  it("awards once across reopening, reload and restoring a completed task", () => {
    const first = withCompletion(task("one"), true, "2026-11-18T12:00:00");
    const reopened = withCompletion(
      JSON.parse(JSON.stringify(first)),
      false,
      "2026-11-19T12:00:00",
    );
    const again = withCompletion(reopened, true, "2026-11-20T12:00:00");
    expect(again.completedAt).toBe(first.completedAt);
    expect(taskerProgress([again]).xp).toBe(25);
    expect(taskerProgress([{ ...again, done: false }]).xp).toBe(25);
    expect(taskerProgress([{ ...task("legacy"), done: true }]).xp).toBe(0);
  });
  it("crosses level thresholds exactly and has 24 unique rewards", () => {
    const tasks = Array.from({ length: 4 }, (_, i) =>
      withCompletion(task(String(i)), true, "2026-11-18T12:00:00"),
    );
    expect(taskerProgress(tasks)).toMatchObject({
      xp: 100,
      level: 2,
      intoLevel: 0,
      needed: 200,
    });
    expect(taskerProgress(tasks.slice(0, 3))).toMatchObject({
      xp: 75,
      level: 1,
      intoLevel: 75,
    });
    expect(new Set(TASKER_BADGES.map(([id]) => id)).size).toBe(24);
  });
  it("recognizes calendar-day streaks, daily focus and distinct areas", () => {
    const tasks = Array.from({ length: 7 }, (_, i) =>
      withCompletion(
        { ...task(String(i)), today: true, group: `Area ${i % 3}` },
        true,
        `2026-11-${String(12 + i).padStart(2, "0")}T08:00:00`,
      ),
    );
    const progress = taskerProgress(tasks);
    expect(progress.badges).toEqual(
      expect.arrayContaining([
        "streak7",
        "early",
        "weekend",
        "areas3",
        "planned5",
      ]),
    );
    expect(progress.badges).not.toContain("day3");
    const gap = tasks.filter((_, i) => i !== 3);
    expect(taskerProgress(gap).badges).not.toContain("streak7");
  });
});
