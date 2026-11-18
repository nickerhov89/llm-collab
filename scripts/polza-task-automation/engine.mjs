import * as fs from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  validateConfig,
  nextDue,
  dayKey,
  instruction,
  isActiveRun,
} from "./model.mjs";
import { NativeClient } from "./native.mjs";
const fileKey = (value) => createHash("sha256").update(value).digest("hex");
export class AutomationEngine {
  constructor({
    accounts,
    directory,
    now = Date.now,
    clientFor,
    automatic = true,
  }) {
    this.accounts = accounts;
    this.directory = directory;
    this.now = now;
    this.automatic = automatic;
    this.clients = new Map(
      Object.entries(accounts).map(([name, realm]) => [
        name,
        clientFor ? clientFor(name) : new NativeClient(realm),
      ]),
    );
    this.locks = new Map();
    this.timer = null;
    this.stopped = false;
    this.ticking = false;
  }
  async read(account) {
    try {
      const raw = await fs.readFile(
        join(this.directory, `${fileKey(account)}.json`),
        "utf8",
      );
      if (Buffer.byteLength(raw) > 8 * 1024 * 1024)
        throw Error("Automation storage limit");
      const state = JSON.parse(raw);
      if (
        state.version !== 1 ||
        !Array.isArray(state.jobs) ||
        state.jobs.length > 64
      )
        throw Error("Invalid automation storage");
      return state;
    } catch (e) {
      if (e.code === "ENOENT") return { version: 1, jobs: [] };
      throw e;
    }
  }
  async write(account, state) {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const outputs = join(this.directory, fileKey(account));
    for (const job of state.jobs)
      for (const run of job.runs)
        if (typeof run.result === "string") {
          await fs.mkdir(outputs, { recursive: true, mode: 0o700 });
          const output = join(outputs, `${run.id}.json`);
          await fs.writeFile(output, JSON.stringify({ text: run.result }), {
            mode: 0o600,
          });
          run.resultPreview = run.result.slice(0, 600);
          run.hasResult = true;
          delete run.result;
        }
    const serialized = JSON.stringify(state);
    if (Buffer.byteLength(serialized) > 8 * 1024 * 1024)
      throw Error("Automation storage limit");
    const tmp = join(this.directory, `.${randomUUID()}.tmp`);
    const file = await fs.open(tmp, "wx", 0o600);
    try {
      await file.writeFile(serialized);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await fs.rename(tmp, join(this.directory, `${fileKey(account)}.json`));
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  }
  async locked(account, fn) {
    if (!Object.hasOwn(this.accounts, account)) throw Error("Unknown account");
    const before = this.locks.get(account) ?? Promise.resolve();
    let release;
    const tail = new Promise((r) => {
      release = r;
    });
    this.locks.set(account, tail);
    await before;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(account) === tail) this.locks.delete(account);
    }
  }
  bump(job) {
    job.revision++;
    job.updatedAt = this.now();
  }
  async task(client, taskId, allowClosed = false) {
    const list = await client.call("GET", "/tasker");
    const task = list.data?.tasks?.find((t) => t.id === taskId);
    if (!task || (!allowClosed && (task.deleted || task.done)))
      throw Error("Save an active task first");
    return task;
  }
  async chat(client, projectId, sessionId, allowClosed = false) {
    const projects = await client.call("GET", "/projects");
    if (!(projects.projects ?? []).some((p) => p.id === projectId))
      throw Error("Project access denied");
    const detail = await client.call(
      "GET",
      `/projects/${projectId}/sessions/${sessionId}/metadata`,
    );
    const session = detail.session ?? {};
    if (!allowClosed && session.isArchived)
      throw Error("Restore the archived chat first");
    return {
      id: `chat:${fileKey(`${projectId}:${sessionId}`)}`,
      title: session.customTitle ?? session.title ?? "Scheduled chat",
      deleted: session.isArchived === true,
      note: "",
    };
  }
  path(job) {
    return `/projects/${encodeURIComponent(job.config.projectId)}/sessions/${encodeURIComponent(job.config.sessionId)}`;
  }
  async context(client, projectId) {
    const projects = await client.call("GET", "/projects");
    const visible = projects.projects ?? [];
    if (!projectId)
      return {
        projects: visible.map((p) => ({ id: p.id, name: p.name ?? p.path })),
      };
    if (!visible.some((p) => p.id === projectId))
      throw Error("Project access denied");
    const sessions = await client.call(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/sessions`,
    );
    return {
      sessions: (sessions.sessions ?? []).map((s) => ({
        id: s.id ?? s.sessionId,
        title: s.title ?? s.id ?? s.sessionId,
      })),
    };
  }
  async handle(account, request) {
    return this.locked(account, async () => {
      const client = this.clients.get(account);
      await client.ready();
      if (request.operation === "context")
        return {
          available: true,
          ...(await this.context(client, request.projectId)),
        };
      const chatSubject = request.subject === "chat";
      if (request.subject && !["chat", "task"].includes(request.subject))
        throw Error("Invalid execution subject");
      const allowClosed = [
        "get",
        "pause",
        "result",
        "approve",
        "reject",
        "acknowledge",
        "inspect",
      ].includes(request.operation);
      let task;
      if (chatSubject) {
        const ids = validateConfig({
          mode: "once",
          projectId: request.projectId,
          sessionId: request.sessionId,
        });
        task = await this.chat(
          client,
          ids.projectId,
          ids.sessionId,
          allowClosed,
        );
      } else {
        if (
          typeof request.taskId !== "string" ||
          !request.taskId ||
          request.taskId.length > 512
        )
          throw Error("Invalid task");
        task = await this.task(client, request.taskId, allowClosed);
      }
      const state = await this.read(account);
      let job = state.jobs.find((j) => j.taskId === task.id);
      if (chatSubject) task.note = job?.prompt ?? "";
      if (request.operation === "get")
        return { available: true, job: job ?? null };
      if (request.operation === "result") {
        const run = job?.runs.find(
          (r) => r.id === request.runId && r.hasResult,
        );
        if (!run || !/^[a-f0-9-]{36}$/.test(run.id))
          throw Error("Result not found");
        return {
          available: true,
          ...JSON.parse(
            await fs.readFile(
              join(this.directory, fileKey(account), `${run.id}.json`),
              "utf8",
            ),
          ),
        };
      }
      if ((job?.revision ?? 0) !== request.revision) {
        const error = Error("Automation changed; refresh before saving");
        error.status = 409;
        throw error;
      }
      if (request.operation === "save") {
        if (job?.runs.some(isActiveRun))
          throw Error(
            "Wait for the active run before changing its configuration",
          );
        const config = validateConfig(request.config);
        if (chatSubject) {
          if (
            config.projectId !== request.projectId ||
            config.sessionId !== request.sessionId
          )
            throw Error("Chat binding mismatch");
          if (!["once", "schedule"].includes(config.mode))
            throw Error(
              "Use the provider's native Goal control for chat goals",
            );
          if (
            typeof request.prompt !== "string" ||
            !request.prompt.trim() ||
            request.prompt.length > 6000
          )
            throw Error("Describe what the chat should do on each run");
        }

        const permitted = await this.context(client, config.projectId);
        if (!permitted.sessions.some((s) => s.id === config.sessionId))
          throw Error("Chat access denied");
        // Native session detail verifies the exact project/session binding.
        await client.call(
          "GET",
          `/projects/${config.projectId}/sessions/${config.sessionId}/metadata`,
        );
        if (
          job &&
          (job.approved > 0 || job.runs.some((r) => r.status === "review")) &&
          ["mode", "criteria", "target", "projectId", "sessionId"].some(
            (key) => job.config[key] !== config[key],
          )
        )
          throw Error(
            "Use a new task for a changed goal after accepting results",
          );
        if (!job) {
          if (state.jobs.length >= 64)
            throw Error("Automation task limit reached");
          job = {
            taskId: task.id,
            revision: 0,
            config,
            enabled: false,
            approved: 0,
            nextAt: null,
            runs: [],
            title: task.title,
          };
          state.jobs.push(job);
        }
        if (chatSubject) {
          job.subject = "chat";
          job.prompt = request.prompt.trim();
          job.title = task.title;
        }
        job.config = config;
        job.enabled = false;
        job.nextAt = null;
        job.reason = null;
      } else {
        if (!job) throw Error("Save execution settings first");
        if (request.operation === "pause") {
          job.enabled = false;
          job.nextAt = null;
          job.reason = "Paused by user";
          await this.cancelQueued(client, job);
        } else if (request.operation === "resume") {
          if (job.config.mode === "once")
            throw Error("Use Run now for a one-time task");
          if (job.runs.some((r) => ["unknown", "human"].includes(r.status)))
            throw Error("Review the uncertain run before continuing");
          if (job.config.mode === "goal" && job.approved >= job.config.target)
            throw Error("Goal already completed");
          job.enabled = true;
          job.reason = null;
          job.nextAt =
            job.config.mode === "schedule"
              ? nextDue(job.config, this.now())
              : this.now();
        } else if (request.operation === "run") {
          await this.launch(account, state, job, task, client);
        } else if (["approve", "reject"].includes(request.operation)) {
          const run = job.runs.find((r) => r.id === request.runId);
          if (run?.status !== "review")
            throw Error("This run is not awaiting review");
          run.status =
            request.operation === "approve" ? "approved" : "rejected";
          run.reviewedAt = this.now();
          if (request.operation === "approve") job.approved++;
          if (job.config.mode === "goal" && job.approved >= job.config.target) {
            job.enabled = false;
            job.nextAt = null;
            job.reason = "Goal completed";
          }
        } else if (request.operation === "inspect") {
          const run = job.runs.find(
            (r) =>
              r.id === request.runId && ["human", "unknown"].includes(r.status),
          );
          if (!run) throw Error("No run awaiting human input");
          run.status = "queued";
          job.reason = null;
        } else if (request.operation === "acknowledge") {
          const run = job.runs.find((r) => r.id === request.runId);
          if (run?.status !== "unknown")
            throw Error("No uncertain run to acknowledge");
          // Acknowledgement never retries a send or counts the run as successful.
          run.status = "dismissed";
          run.reviewedAt = this.now();
          job.reason = "Uncertain run reviewed; enable manually to continue";
        } else throw Error("Unknown operation");
      }
      this.bump(job);
      await this.write(account, state);
      this.arm();
      return { available: true, job };
    });
  }
  async cancelQueued(client, job) {
    for (const run of job.runs.filter(
      (r) => r.status === "queued" && r.queueId,
    )) {
      const queue = await client.call(
        "GET",
        `/projects/${job.config.projectId}/queue`,
      );
      const item = (queue.items ?? []).find((x) => x.id === run.queueId);
      if (item?.status === "queued" || item?.status === "failed") {
        await client.call(
          "DELETE",
          `/projects/${job.config.projectId}/queue/${run.queueId}`,
        );
        run.status = "cancelled";
      }
    }
  }
  async launch(account, state, job, task, client) {
    if (
      job.runs.some(
        (r) => isActiveRun(r) || ["unknown", "human"].includes(r.status),
      )
    )
      throw Error("A run is active or requires review");
    if (
      job.runs.filter((r) => r.status === "review").length >=
      job.config.pendingLimit
    )
      throw Error("Review the prepared results first");
    if (job.config.mode === "goal" && job.approved >= job.config.target)
      throw Error("Goal already completed");
    if (
      job.config.mode === "goal" &&
      job.approved + job.runs.filter((r) => r.status === "review").length >=
        job.config.target
    )
      throw Error("Review the prepared goal results first");
    const today = dayKey(this.now(), job.config.timezone);
    if (
      job.runs.filter((r) => dayKey(r.startedAt, job.config.timezone) === today)
        .length >= job.config.dailyLimit
    )
      throw Error("Daily execution limit reached");
    const retired = [];
    if (job.subject === "chat") {
      while (job.runs.length >= 100) {
        const index = job.runs.findIndex((r) =>
          [
            "completed",
            "approved",
            "rejected",
            "cancelled",
            "dismissed",
            "failed",
          ].includes(r.status),
        );
        if (index < 0) break;
        retired.push(job.runs.splice(index, 1)[0].id);
      }
    }
    if (job.runs.length >= 100)
      throw Error("Execution history limit reached; review old runs first");
    if (job.subject === "chat") {
      const metadata = await client.call("GET", `${this.path(job)}/metadata`);
      const commands = metadata.slashCommands ?? [];
      const nativeGoal = commands.find(
        (c) => c.name === "goal",
      )?.providerDetails;
      if (
        nativeGoal?.codex?.goalStatus === "active" ||
        nativeGoal?.claude?.goalStatus === "active"
      ) {
        job.enabled = false;
        job.nextAt = null;
        throw Error("Pause the native Goal before enabling scheduled runs");
      }
    }
    const detail = await client.call("GET", this.path(job));
    const baseline = detail.messages?.at(-1)?.uuid ?? null;
    const run = {
      id: randomUUID(),
      status: "dispatching",
      startedAt: this.now(),
      baseline,
      sessionId: job.config.sessionId,
      projectId: job.config.projectId,
    };
    job.runs.push(run);
    job.reason = null;
    this.bump(job);
    // Persist the intention before any non-idempotent native call. Never replay an uncertain enqueue.
    await this.write(account, state);
    await Promise.allSettled(
      retired.map((id) =>
        fs.unlink(join(this.directory, fileKey(account), `${id}.json`)),
      ),
    );
    try {
      const result = await client.call(
        "POST",
        `/projects/${job.config.projectId}/queue`,
        {
          target: { type: "existing-session", sessionId: job.config.sessionId },
          message: { text: instruction(task, job, run) },
        },
      );
      if (!result.item?.id) throw Error("Missing queue receipt");
      run.queueId = result.item.id;
      run.status = "queued";
      job.nextAt =
        job.config.mode === "schedule"
          ? nextDue(job.config, this.now())
          : this.now() + 60000;
    } catch (error) {
      run.status = error.definiteRejected ? "failed" : "unknown";
      job.enabled = false;
      job.nextAt = null;
      job.reason = error.definiteRejected
        ? error.message
        : "Delivery not confirmed; inspect the chat and queue before continuing";
    }
    this.bump(job);
    await this.write(account, state);
  }
  async observe(client, job, run) {
    const queue = await client.call(
      "GET",
      `/projects/${job.config.projectId}/queue`,
    );
    const item = (queue.items ?? []).find((x) => x.id === run.queueId);
    if (item) {
      if (item.status === "failed") {
        run.status = "failed";
        job.enabled = false;
        job.reason = "Native queue could not start this run; inspect the chat";
      } else
        job.reason =
          queue.dispatchState?.status === "paused"
            ? "Project Queue is paused"
            : "Waiting for the project queue";
      return;
    }
    const metadata = await client.call("GET", `${this.path(job)}/metadata`);
    const processState =
      metadata.processState ?? metadata.session?.processState;
    if (processState === "in-turn" || processState === "starting") {
      run.status = "running";
      job.reason = null;
      return;
    }
    if (processState === "waiting-input") {
      job.enabled = false;
      run.status = "human";
      job.reason = "The agent needs human input in the chat";
      return;
    }
    const suffix = run.baseline
      ? `?afterMessageId=${encodeURIComponent(run.baseline)}`
      : "";
    const detail = await client.call("GET", `${this.path(job)}${suffix}`);
    if (detail.pendingInputRequest) {
      job.enabled = false;
      run.status = "human";
      job.reason = "The agent needs human input in the chat";
      return;
    }
    const messages = detail.messages ?? [];
    const marker = `Tasker execution ${run.id}.`;
    const start = messages.findIndex(
      (m) =>
        m.type === "user" &&
        (m.message?.content ?? []).some(
          (b) => b.type === "text" && b.text?.includes(marker),
        ),
    );
    const correlated = start >= 0 ? messages.slice(start + 1) : [];

    // Tasker results require review; chat schedules record completed turns, not goal completion.
    const assistant = correlated
      .filter((m) => m.type === "assistant")
      .flatMap((m) => m.message?.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n\n");
    if (
      assistant &&
      (processState === "idle" || detail.ownership?.owner !== "self")
    ) {
      run.status = job.subject === "chat" ? "completed" : "review";
      run.result = assistant.slice(-80000);
      run.resultTruncated = assistant.length > 80000;
      run.finishedAt = this.now();
      job.reason =
        job.subject === "chat"
          ? "Scheduled run completed; result is in the chat"
          : "Result awaiting your review";
    } else if (
      this.now() - run.startedAt > 60000 &&
      processState !== "in-turn"
    ) {
      run.status = "unknown";
      job.enabled = false;
      job.reason = "No confirmed result; inspect the chat before retrying";
    }
  }
  async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    let wake = Infinity;
    try {
      for (const account of Object.keys(this.accounts)) {
        if (this.stopped) break;
        await this.locked(account, async () => {
          const state = await this.read(account);
          const eligible = state.jobs.filter((j) => {
            if (j.runs.some(isActiveRun)) return true;
            if (
              !j.enabled ||
              j.runs.filter((r) => r.status === "review").length >=
                j.config.pendingLimit ||
              (j.config.mode === "goal" &&
                j.approved +
                  j.runs.filter((r) => r.status === "review").length >=
                  j.config.target)
            )
              return false;
            if (j.nextAt > this.now()) {
              wake = Math.min(wake, j.nextAt);
              return false;
            }
            return true;
          });
          const candidates = eligible.slice(0, 8);
          if (eligible.length > 8) wake = Math.min(wake, this.now() + 15000);
          if (!candidates.length) return;
          const client = this.clients.get(account);
          try {
            await client.ready();
          } catch {
            for (const j of candidates) {
              j.enabled = false;
              j.reason =
                "Account access unavailable; enable again after restoring access";
              for (const r of j.runs.filter(isActiveRun)) r.status = "unknown";
              this.bump(j);
            }
            await this.write(account, state);
            return;
          }
          const list = candidates.some((j) => j.subject !== "chat")
            ? await client.call("GET", "/tasker")
            : null;
          for (const job of candidates) {
            if (this.stopped) break;
            let task;
            try {
              task =
                job.subject === "chat"
                  ? await this.chat(
                      client,
                      job.config.projectId,
                      job.config.sessionId,
                      true,
                    )
                  : list?.data?.tasks?.find((t) => t.id === job.taskId);
              if (task && job.subject === "chat") task.note = job.prompt;
            } catch {
              job.enabled = false;
              job.nextAt = null;
              job.reason =
                "Chat access unavailable; restore access before continuing";
              for (const r of job.runs.filter(isActiveRun))
                r.status = "unknown";
              this.bump(job);
              continue;
            }
            if (!task || task.deleted || task.done) {
              job.enabled = false;
              job.reason = "Task completed or removed";
              await this.cancelQueued(client, job);
            }
            const run = job.runs.find(isActiveRun);
            try {
              if (run) await this.observe(client, job, run);
              else if (
                job.enabled &&
                job.nextAt <= this.now() &&
                task &&
                !task.done &&
                !task.deleted
              )
                await this.launch(account, state, job, task, client);
            } catch (e) {
              job.reason = e.message;
              if (run) {
                run.observationFailures = (run.observationFailures ?? 0) + 1;
                if (e.definiteRejected || run.observationFailures >= 3) {
                  run.status = "unknown";
                  job.enabled = false;
                }
              }
              if (/Daily execution/.test(e.message))
                job.nextAt = nextDue(
                  { ...job.config, cadence: "daily", time: "00:00" },
                  this.now(),
                );
              else if (!job.runs.some(isActiveRun)) {
                job.enabled = false;
                job.nextAt = null;
              }
            }
            this.bump(job);
            if (job.runs.some(isActiveRun))
              wake = Math.min(wake, this.now() + 15000);
            else if (
              job.enabled &&
              job.runs.filter((r) => r.status === "review").length <
                job.config.pendingLimit &&
              !(
                job.config.mode === "goal" &&
                job.approved +
                  job.runs.filter((r) => r.status === "review").length >=
                  job.config.target
              )
            )
              wake = Math.min(wake, job.nextAt ?? this.now() + 15000);
          }
          await this.write(account, state);
        }).catch(() => {
          wake = Math.min(wake, this.now() + 60000);
        });
      }
    } finally {
      this.ticking = false;
      if (Number.isFinite(wake)) this.arm(Math.max(15000, wake - this.now()));
    }
  }
  arm(delay = 100) {
    if (!this.automatic || this.stopped) return;
    const due = this.now() + Math.min(delay, 2147483647);
    if (this.timer && this.timerAt <= due) return;
    clearTimeout(this.timer);
    this.timerAt = due;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.tick();
      },
      Math.max(0, due - this.now()),
    );
    this.timer.unref();
  }
  async start() {
    for (const account of Object.keys(this.accounts)) {
      const state = await this.read(account);
      let changed = false;
      for (const job of state.jobs)
        for (const run of job.runs)
          if (run.status === "dispatching") {
            run.status = "unknown";
            job.enabled = false;
            job.reason =
              "Interrupted handoff; inspect the chat before continuing";
            this.bump(job);
            changed = true;
          }
      if (changed) await this.write(account, state);
    }
    await this.tick();
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await Promise.all([...this.locks.values()]);
    await Promise.all([...this.clients.values()].map((c) => c.close?.()));
  }
}
