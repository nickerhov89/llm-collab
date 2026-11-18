import { describe, it, expect } from "vitest";
import { reorderTaskSubset } from "../taskerOrder";

describe("manual Tasker order", () => {
  it("moves visible rows, preserving hidden slots and all task metadata", () => {
    const tasks = [
      { id: "old", note: "unchanged" },
      { id: "hidden", note: "keep" },
      { id: "middle", note: "draft", earnedXp: 25 },
      { id: "new", note: "latest" },
    ];
    const next = reorderTaskSubset(
      tasks,
      ["new", "middle", "old"],
      "new",
      "old",
    );
    expect(next.map((t) => t.id)).toEqual(["new", "hidden", "old", "middle"]);
    expect(
      next
        .filter((t) => t.id !== "hidden")
        .reverse()
        .map((t) => t.id),
    ).toEqual(["middle", "old", "new"]);
    expect(next.find((t) => t.id === "middle")).toBe(tasks[2]);
    expect(next[1]).toBe(tasks[1]);
    expect(tasks.map((t) => t.id)).toEqual(["old", "hidden", "middle", "new"]);
    expect([...next, { id: "added", note: "" }].reverse()[0]?.id).toBe("added");
  });
  it("retains the array on cancelled, stale or ambiguous moves", () => {
    const tasks = [{ id: "one" }, { id: "two" }];
    expect(reorderTaskSubset(tasks, ["two", "one"], "two", "two")).toBe(tasks);
    expect(reorderTaskSubset(tasks, ["two", "one"], "removed", "one")).toBe(
      tasks,
    );
    expect(reorderTaskSubset(tasks, ["two", "two", "one"], "two", "one")).toBe(
      tasks,
    );
  });
});
