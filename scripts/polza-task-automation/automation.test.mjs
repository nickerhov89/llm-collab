import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AutomationEngine } from "./engine.mjs";
import { nextDue, validateConfig } from "./model.mjs";
const config = (extra = {}) => ({
  mode: "goal",
  projectId: "project",
  sessionId: "session",
  criteria: "A complete article supported by sources",
  target: 2,
  dailyLimit: 3,
  pendingLimit: 3,
  timezone: "Europe/Moscow",
  cadence: "daily",
  time: "09:00",
  ...extra,
});
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "polza-automation-"));
  let now = Date.parse("2026-11-18T06:00:00Z");
  let queue = [];
  let calls = 0;
  let failAfterPost = false;
  let result = false;
  let revoked = false;
  let prompt = "";
  const fake = {
    ready: async () => {
      if (revoked) throw Error("revoked");
    },
    call: async (method, path, body) => {
      if (path === "/tasker")
        return {
          data: {
            tasks: [
              { id: "task", title: "Article", note: "Use real evidence" },
            ],
          },
        };
      if (path === "/projects")
        return { projects: [{ id: "project", name: "Marketing" }] };
      if (path === "/projects/project/sessions")
        return { sessions: [{ id: "session", title: "Writing" }] };
      if (path.endsWith("/metadata")) return { processState: "idle" };
      if (path.startsWith("/projects/project/sessions/session"))
        return {
          ownership: { owner: "self" },
          messages: result
            ? [
                {
                  uuid: "request",
                  type: "user",
                  message: { content: [{ type: "text", text: prompt }] },
                },
                {
                  uuid: "answer",
                  type: "assistant",
                  message: {
                    content: [{ type: "text", text: "Article and evidence" }],
                  },
                },
              ]
            : [],
        };
      if (path === "/projects/project/queue") {
        if (method === "POST") {
          calls++;
          prompt = body.message.text;
          queue = [{ id: "queue-" + calls, status: "queued" }];
          if (failAfterPost) throw Error("Lost response");
          return { item: queue[0] };
        }
        return { items: queue };
      }
      if (method === "DELETE") {
        queue = [];
        return {};
      }
      throw Error(path);
    },
  };
  const engine = new AutomationEngine({
    accounts: { staff: {} },
    directory,
    now: () => now,
    automatic: false,
    clientFor: () => fake,
  });
  t.after(async () => {
    await engine.stop();
    await rm(directory, { recursive: true, force: true });
  });
  const call = async (operation, extra = {}) => {
    const state = await engine.read("staff");
    return engine.handle("staff", {
      operation,
      taskId: "task",
      revision: state.jobs[0]?.revision ?? 0,
      ...extra,
    });
  };
  await call("save", { config: config() });
  return {
    engine,
    call,
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
    done: () => {
      queue = [];
      result = true;
    },
    revoke: () => {
      revoked = true;
    },
    loseReply: () => {
      failAfterPost = true;
    },
    calls: () => calls,
  };
}
test("goal counts human-accepted results and stops at the target", async (t) => {
  const f = await fixture(t);
  await f.call("resume");
  await f.engine.tick();
  assert.equal(f.calls(), 1);
  f.done();
  await f.engine.tick();
  let job = (await f.call("get")).job;
  assert.equal(job.approved, 0);
  assert.equal(job.runs[0].status, "review");
  const full = await f.call("result", { runId: job.runs[0].id });
  assert.equal(full.text, "Article and evidence");
  await f.call("approve", { runId: job.runs[0].id });
  f.advance(61000);
  await f.engine.tick();
  assert.equal(f.calls(), 2);
  f.done();
  await f.engine.tick();
  job = (await f.call("get")).job;
  await f.call("approve", { runId: job.runs[1].id });
  job = (await f.call("get")).job;
  assert.equal(job.approved, 2);
  assert.equal(job.enabled, false);
  await assert.rejects(f.call("approve", { runId: job.runs[1].id }));
  await f.engine.tick();
  assert.equal(f.calls(), 2);
});
test("unknown delivery is not replayed on retries or restart", async (t) => {
  const f = await fixture(t);
  f.loseReply();
  await f.call("run");
  let job = (await f.call("get")).job;
  assert.equal(job.runs[0].status, "unknown");
  await assert.rejects(f.call("run"));
  await assert.rejects(f.call("resume"));
  await f.engine.start();
  f.advance(3600000);
  await f.engine.tick();
  job = (await f.call("get")).job;
  assert.equal(job.enabled, false);
  assert.equal(f.calls(), 1);
});
test("pause cancels queued work; stale edits and revoked accounts cannot launch", async (t) => {
  const f = await fixture(t);
  const stale = (await f.call("get")).job.revision;
  await f.call("run");
  await f.call("pause");
  assert.equal((await f.call("get")).job.runs[0].status, "cancelled");
  await assert.rejects(
    f.engine.handle("staff", {
      operation: "save",
      taskId: "task",
      revision: stale,
      config: config(),
    }),
    /changed/,
  );
  await f.call("resume");
  f.revoke();
  await f.engine.tick();
  assert.equal((await f.engine.read("staff")).jobs[0].enabled, false);
  assert.equal(f.calls(), 1);
});
test("schedule uses Moscow calendar, skips missed runs and respects DST gaps", () => {
  const c = validateConfig(config({ mode: "schedule", cadence: "weekdays" }));
  assert.equal(
    new Date(nextDue(c, Date.parse("2026-11-20T06:00:00Z"))).toISOString(),
    "2026-11-23T06:00:00.000Z",
  );
  const dst = validateConfig(
    config({
      mode: "schedule",
      cadence: "daily",
      timezone: "Europe/Berlin",
      time: "02:30",
    }),
  );
  assert.equal(
    new Date(nextDue(dst, Date.parse("2026-03-28T23:00:00Z"))).toISOString(),
    "2026-03-30T00:30:00.000Z",
  );
  assert.throws(() => validateConfig(config({ dailyLimit: 500 })));
  assert.throws(() => validateConfig(config({ projectId: "../../owner" })));
});
