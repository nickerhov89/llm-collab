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
  let archived = false;
  const paths = [];
  const fake = {
    ready: async () => {
      if (revoked) throw Error("revoked");
    },
    call: async (method, path, body) => {
      paths.push(path);
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
      if (path.endsWith("/metadata"))
        return { processState: "idle", session: { isArchived: archived } };
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
    paths,
    archive: () => {
      archived = true;
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

test("chat schedules belong to the exact chat and keep repeating without Tasker reviews", async (t) => {
  const f = await fixture(t);
  const identity = {
    subject: "chat",
    projectId: "project",
    sessionId: "session",
  };
  const chat = async (operation, extra = {}) => {
    const current = await f.engine.handle("staff", {
      ...identity,
      operation: "get",
    });
    return f.engine.handle("staff", {
      ...identity,
      operation,
      revision: current.job?.revision ?? 0,
      ...extra,
    });
  };
  const before = f.paths.filter((p) => p === "/tasker").length;
  await chat("save", {
    prompt: "Prepare the daily report",
    config: config({
      mode: "schedule",
      cadence: "interval",
      intervalMinutes: 1,
    }),
  });
  await chat("resume");
  await f.engine.tick();
  assert.equal(f.calls(), 0);
  for (let i = 1; i <= 3; i++) {
    f.advance(61000);
    await f.engine.tick();
    assert.equal(f.calls(), i);
    f.done();
    await f.engine.tick();
    const job = (await chat("get")).job;
    assert.equal(job.runs.at(-1).status, "completed");
    assert.equal(job.enabled, true);
  }
  f.advance(61000);
  await f.engine.tick();
  assert.equal(f.calls(), 3);
  const job = (await chat("get")).job;
  assert.equal(job.enabled, true);
  assert.equal(new Date(job.nextAt).toISOString(), "2026-11-18T21:00:00.000Z");
  assert.equal(f.paths.filter((p) => p === "/tasker").length, before);
  await assert.rejects(
    chat("save", {
      prompt: "Wrong chat",
      config: config({ mode: "schedule", sessionId: "other" }),
    }),
  );
  await chat("pause");
});

test("archiving a scheduled chat stops future work; weekly days and interval validation are explicit", async (t) => {
  const f = await fixture(t);
  const identity = {
    subject: "chat",
    projectId: "project",
    sessionId: "session",
  };
  const saved = await f.engine.handle("staff", {
    ...identity,
    operation: "save",
    revision: 0,
    prompt: "Report",
    config: config({
      mode: "schedule",
      cadence: "interval",
      intervalMinutes: 1,
    }),
  });
  await f.engine.handle("staff", {
    ...identity,
    operation: "resume",
    revision: saved.job.revision,
  });
  f.archive();
  f.advance(61000);
  await f.engine.tick();
  const job = (
    await f.engine.handle("staff", { ...identity, operation: "get" })
  ).job;
  assert.equal(job.enabled, false);
  assert.equal(f.calls(), 0);
  assert.throws(() =>
    validateConfig(config({ cadence: "interval", intervalMinutes: 0 })),
  );
  assert.throws(() =>
    validateConfig(config({ cadence: "weekly", weekdays: [] })),
  );
  assert.equal(
    new Date(
      nextDue(
        validateConfig(
          config({ cadence: "weekly", weekdays: [5], time: "10:30" }),
        ),
        Date.parse("2026-11-18T06:00:00Z"),
      ),
    ).toISOString(),
    "2026-11-20T07:30:00.000Z",
  );
});

test("chat history rotates confirmed runs without exceeding the retention bound", async (t) => {
  const f = await fixture(t);
  const identity = {
    subject: "chat",
    projectId: "project",
    sessionId: "session",
  };
  const saved = await f.engine.handle("staff", {
    ...identity,
    operation: "save",
    revision: 0,
    prompt: "Report",
    config: config({ mode: "schedule", cadence: "daily" }),
  });
  const state = await f.engine.read("staff");
  const job = state.jobs.find((j) => j.taskId === saved.job.taskId);
  job.runs = Array.from({ length: 100 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    status: "completed",
    result: "Earlier result",
    startedAt: f.now() - 86400000,
  }));
  await f.engine.write("staff", state);
  await f.engine.handle("staff", {
    ...identity,
    operation: "run",
    revision: job.revision,
  });
  const current = (
    await f.engine.handle("staff", { ...identity, operation: "get" })
  ).job;
  assert.equal(current.runs.length, 100);
  assert.equal(current.runs[0].id.endsWith("000000000001"), true);
  assert.equal(current.runs.at(-1).status, "queued");
  assert.equal(f.calls(), 1);
});
