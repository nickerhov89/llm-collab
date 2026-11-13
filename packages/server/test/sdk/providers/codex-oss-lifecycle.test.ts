import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { MessageQueue } from "../../../src/sdk/messageQueue.js";
import { CodexOSSProvider } from "../../../src/sdk/providers/codex-oss.js";
import type { StartSessionOptions } from "../../../src/sdk/providers/types.js";
import type { SDKMessage } from "../../../src/sdk/types.js";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn,
}));
vi.mock("../../../src/sdk/cli-detection.js", () => ({
  findCodexCliPath: async () => "/mock/codex",
}));

it("accepts the next turn when the CLI closes while the result consumer is paused", async () => {
  const child = Object.assign(new EventEmitter(), {
    pid: 12345,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    kill: vi.fn(() => {
      child.killed = true;
      return true;
    }),
  });
  spawn.mockReturnValue(child);
  const queue = new MessageQueue();
  queue.push({ text: "one", uuid: "u1" });
  const controller = new AbortController();
  const provider = new CodexOSSProvider();
  const internal = provider as unknown as {
    runSession(
      options: StartSessionOptions,
      route: null,
      queue: MessageQueue,
      signal: AbortSignal,
      pid: object,
    ): AsyncIterableIterator<SDKMessage>;
  };
  const iterator = internal.runSession(
    { cwd: "/fixture" } as StartSessionOptions,
    null,
    queue,
    controller.signal,
    {},
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    expect((await iterator.next()).value.type).toBe("user");
    const init = iterator.next();
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    child.stdout.end(
      [
        { type: "thread.started", thread_id: "native-thread" },
        {
          type: "turn.completed",
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]
        .map((item) => JSON.stringify(item))
        .join("\n") + "\n",
    );
    expect((await init).value.type).toBe("system");
    let sawResult = false;
    for (let i = 0; i < 4; i++) {
      const message = (await iterator.next()).value;
      if (message.type === "system" && message.subtype === "turn_complete") {
        sawResult = true;
        break;
      }
    }
    expect(sawResult).toBe(true);
    // The event occurs during consumer backpressure, before its next next().
    child.emit("close", 0);
    queue.push({ text: "two", uuid: "u2" });
    const nextUser = (async () => {
      for (let i = 0; i < 4; i++) {
        const next = await iterator.next();
        if (next.value?.type === "user") return next.value;
      }
      throw new Error("Second turn was not consumed");
    })();
    const second = await Promise.race([
      nextUser,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Lost close event blocked the next turn")),
          800,
        );
      }),
    ]);
    expect(second.uuid).toBe("u2");
  } finally {
    clearTimeout(timer);
    controller.abort();
    child.emit("close", 0);
    queue.push({ text: "cleanup", uuid: "cleanup" });
    await iterator.return(undefined);
    vi.restoreAllMocks();
  }
});
