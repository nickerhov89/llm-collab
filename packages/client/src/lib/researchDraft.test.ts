import { describe, expect, it } from "vitest";
import {
  hasResearchDraft,
  researchDraft,
  researchToken,
} from "./researchDraft";
describe("research draft mode", () => {
  it("toggles without dropping the brief or duplicating the skill", () => {
    const brief = "Compare providers\nwith sources and citations.";
    const active = researchDraft(brief, "$deep-research", true);
    expect(active).toBe(`$deep-research ${brief}`);
    expect(hasResearchDraft(active)).toBe(true);
    expect(researchDraft(active, "$deep-research", false)).toBe(active);
    expect(researchDraft(active, "$deep-research", true)).toBe(brief);
    expect(hasResearchDraft("Quote $deep-research in documentation")).toBe(
      false,
    );
  });
  it("adapts the leading invocation across providers and can turn off while inventory is unavailable", () => {
    const brief = "Find original sources";
    const codex = researchDraft(brief, "$deep-research", true);
    expect(researchDraft(codex, "/deep-research", false)).toBe(
      `/deep-research ${brief}`,
    );
    expect(researchDraft(codex, null, false)).toBe(codex);
    expect(researchDraft(codex, null, true)).toBe(brief);
    expect(researchDraft(brief, null, true)).toBe(brief);
    expect(
      researchToken([
        {
          name: "deep-research",
          description: "Research",
          invocation: { kind: "skill", prefix: "$" },
        },
      ]),
    ).toBe("$deep-research");
  });
});
