// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePolzaChatSchedule } from "./PolzaChatSchedule";
const mock = vi.hoisted(() => ({ fetch: vi.fn(), command: vi.fn() }));
vi.mock("../api/client", () => ({ fetchJSON: mock.fetch }));
vi.mock("../i18n", () => {
  const t = (key: string) => key;
  return { useI18n: () => ({ t }) };
});
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
});
function mount() {
  return renderHook(() =>
    usePolzaChatSchedule({
      projectId: "project",
      sessionId: "session",
      enabled: true,
      onGoalCommand: mock.command,
      getDraft: () => "Keep my draft",
      setDraft: vi.fn(),
    }),
  );
}
it("keeps a partially saved schedule paused on activation failure and retries using the saved revision", async () => {
  let job: unknown = null;
  let fail = true;
  const operations: { operation: string; revision: number }[] = [];
  mock.fetch.mockImplementation(
    async (path: string, init?: { body?: string }) => {
      if (path.endsWith("/metadata")) return { slashCommands: [] };
      if (!init?.body) return { available: true, job };
      const request = JSON.parse(init.body);
      operations.push(request);
      if (request.operation === "resume") {
        if (fail) throw Error("Activation unavailable");
        job = { ...(job as object), revision: 3, enabled: true };
      } else
        job = {
          revision: request.revision + 1,
          config: request.config,
          prompt: request.prompt,
          enabled: false,
          nextAt: null,
          runs: [],
        };
      return { job };
    },
  );
  const { result } = mount();
  await act(async () => {
    await result.current.edit();
  });
  let accepted: boolean | undefined;
  await act(async () => {
    accepted = await result.current.submit("Keep my draft");
  });
  expect(accepted).toBe(false);
  expect(result.current.open).toBe(true);
  expect(result.current.job?.enabled).toBe(false);
  expect(result.current.error).toBe("Activation unavailable");
  fail = false;
  await act(async () => {
    accepted = await result.current.submit("Keep my draft");
  });
  expect(accepted).toBe(true);
  expect(operations.map((r) => [r.operation, r.revision])).toEqual([
    ["save", 0],
    ["resume", 1],
    ["save", 1],
    ["resume", 2],
  ]);
  expect(result.current.open).toBe(false);
});
it("does not save twice on repeated submit or activate while a native goal is still active", async () => {
  let settle!: (value: unknown) => void;
  let goalActive = true;
  mock.fetch.mockImplementation(
    async (path: string, init?: { body?: string }) => {
      if (path.endsWith("/metadata"))
        return {
          slashCommands: [
            {
              name: "goal",
              providerDetails: {
                codex: { goalStatus: goalActive ? "active" : "paused" },
              },
            },
          ],
        };
      if (!init?.body) return { available: true, job: null };
      const r = JSON.parse(init.body);
      if (r.operation === "save")
        return new Promise((resolve) => {
          settle = resolve;
        });
      return {
        job: { revision: 2, config: r.config, enabled: true, runs: [] },
      };
    },
  );
  mock.command.mockImplementation(async () => {
    goalActive = false;
  });
  const { result } = mount();
  await act(async () => {
    await result.current.edit();
  });
  let first!: Promise<boolean>;
  act(() => {
    first = result.current.submit("Recurring brief");
  });
  expect(await result.current.submit("Recurring brief")).toBe(false);
  await act(async () => {
    settle({
      job: {
        revision: 1,
        config: result.current.config,
        enabled: false,
        runs: [],
      },
    });
    await first;
  });
  expect(mock.command.mock.calls).toEqual([["/goal pause"]]);
  expect(
    mock.fetch.mock.calls.filter(
      ([, init]) => init?.body && JSON.parse(init.body).operation === "save",
    ),
  ).toHaveLength(1);
});
