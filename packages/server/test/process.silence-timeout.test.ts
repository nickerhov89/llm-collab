import { afterEach, describe, expect, it, vi } from "vitest";
import { Process, createControllableIterator } from "./process.test-support.js";
import type { ProcessEvent, UrlProjectId } from "./process.test-support.js";

afterEach(() => vi.useRealTimers());
const timeout = 10 * 60_000;

function setup(abort?: () => Promise<void>) {
  vi.useFakeTimers();
  const controller = createControllableIterator();
  let alive = true;
  const abortFn = vi.fn(async () => {
    await abort?.();
    alive = false;
    controller.finish();
  });
  const process = new Process(controller.iterator, {
    projectPath: "/test",
    projectId: "proj-1" as UrlProjectId,
    sessionId: "silent-test",
    provider: "codex",
    abortFn,
    isProcessAlive: () => alive,
    probeLivenessFn: async () => ({
      status: "active",
      source: "test",
      checkedAt: new Date(),
    }),
  });
  const events: ProcessEvent[] = [];
  process.subscribe((event) => events.push(event));
  return { process, controller, abortFn, events };
}

describe("opted-in silent foreground deadline", () => {
  it("fails despite an active probe, persists an error, and fences a pending teardown", async () => {
    let stop!: () => void;
    const pending = new Promise<void>((resolve) => {
      stop = resolve;
    });
    const { process, abortFn, events } = setup(() => pending);
    await vi.advanceTimersByTimeAsync(timeout);
    await process.probeLiveness();
    expect(process.getLivenessSnapshot().derivedStatus).toBe(
      "verified-waiting-provider",
    );
    const failure = process.expireSilentTurn(timeout);
    expect(process.state.type).toBe("terminated");
    expect(process.hasUnverifiedProviderOwnership).toBe(true);
    expect(events.some((e) => e.type === "complete")).toBe(false);
    expect(events.find((e) => e.type === "terminated")).toMatchObject({
      failureNotice: {
        content: "Run timed out: no new provider or tool output",
      },
    });
    expect(events.find((e) => e.type === "error")).toBeDefined();
    expect(await process.expireSilentTurn(timeout)).toBe(false);
    stop();
    expect(await failure).toBe(true);
    expect(abortFn).toHaveBeenCalledOnce();
    expect(process.hasUnverifiedProviderOwnership).toBe(false);
    expect(events.filter((e) => e.type === "complete")).toHaveLength(1);
  });

  it("resets only on provider output and respects disabled and idle states", async () => {
    const { process, controller, abortFn } = setup();
    await vi.advanceTimersByTimeAsync(timeout - 1);
    controller.push({
      type: "assistant",
      message: { content: "Still working" },
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(timeout - 1);
    expect(await process.expireSilentTurn(timeout)).toBe(false);
    expect(await process.expireSilentTurn(0)).toBe(false);
    expect(await process.expireSilentTurn(Number.NaN)).toBe(false);
    controller.push({ type: "result", session_id: "silent-test" });
    await vi.advanceTimersByTimeAsync(timeout);
    expect(process.state.type).toBe("idle");
    expect(await process.expireSilentTurn(timeout)).toBe(false);
    expect(abortFn).not.toHaveBeenCalled();
    controller.finish();
  });

  it("keeps ownership blocked if provider shutdown fails", async () => {
    const { process, controller, events } = setup(async () => {
      throw new Error("provider refused shutdown");
    });
    await vi.advanceTimersByTimeAsync(timeout);
    await expect(process.expireSilentTurn(timeout)).rejects.toThrow(
      "provider refused shutdown",
    );
    expect(process.state.type).toBe("terminated");
    expect(process.hasUnverifiedProviderOwnership).toBe(true);
    expect(process.queueMessage({ text: "retry" }).success).toBe(false);
    expect(events.some((e) => e.type === "complete")).toBe(false);
    controller.finish();
  });

  it("does not expire a turn awaiting user approval", async () => {
    const { process, controller, abortFn } = setup();
    controller.push({
      type: "system",
      subtype: "input_request",
      input_request: {
        id: "approval",
        type: "tool-approval",
        prompt: "Approve?",
      },
    });
    await vi.advanceTimersByTimeAsync(timeout * 2);
    expect(process.state.type).toBe("waiting-input");
    expect(await process.expireSilentTurn(timeout)).toBe(false);
    expect(abortFn).not.toHaveBeenCalled();
    controller.finish();
  });
});
