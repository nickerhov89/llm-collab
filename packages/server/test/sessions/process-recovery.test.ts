import { describe, expect, it } from "vitest";
import { shouldRestartProviderOnRestore } from "../../src/sessions/process-recovery.js";

describe("shouldRestartProviderOnRestore", () => {
  it.each([
    "underlying process terminated",
    "Claude SDK API error; restart required",
    "stale: no SDK messages for 180s",
  ])("restarts after an unexpected provider exit: %s", (terminationReason) => {
    expect(
      shouldRestartProviderOnRestore({
        terminationReason,
        archived: false,
        autoResumeAllowed: true,
      }),
    ).toBe(true);
  });

  it.each([
    { terminationReason: undefined, archived: false, autoResumeAllowed: true },
    {
      terminationReason: "underlying process terminated",
      archived: true,
      autoResumeAllowed: true,
    },
    {
      terminationReason: "underlying process terminated",
      archived: false,
      autoResumeAllowed: false,
    },
    {
      terminationReason: "normal completion",
      archived: false,
      autoResumeAllowed: true,
    },
  ])("does not restart a normal or explicitly stopped session: %j", (args) => {
    expect(shouldRestartProviderOnRestore(args)).toBe(false);
  });
});
