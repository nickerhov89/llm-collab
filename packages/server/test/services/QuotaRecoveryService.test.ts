import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  toUrlProjectId,
  type ProviderName,
  type ProviderRuntimeStatus,
} from "@yep-anywhere/shared";
import {
  QuotaRecoveryService,
  type QuotaRecoverySource,
} from "../../src/services/QuotaRecoveryService.js";
import { ProjectQueueService } from "../../src/services/ProjectQueueService.js";
import { EventBus } from "../../src/watcher/EventBus.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const pid = toUrlProjectId("/tmp/quota-project");
const failure = (provider: ProviderName): ProviderRuntimeStatus => ({
  kind: "terminal",
  reason: "rate_limit",
  provider,
  message: "quota exceeded SECRET_NOT_FOR_LEDGER",
  source: "fixture",
  occurredAt: new Date().toISOString(),
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "quota-recovery-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const bus = new EventBus();
  const queue = new ProjectQueueService({
    dataDir: join(dir, "queue"),
    eventBus: bus,
  });
  await queue.initialize();
  const sources = new Map<string, QuotaRecoverySource>();
  sources.set("source", {
    turnKey: "turn-1",
    provider: "claude",
    projectPath: "/tmp/quota-project",
    actor: "marker",
    hasPartialActivity: false,
    hasInlineMedia: false,
    handoff: "EXACT_CURRENT_TASK",
    launch: {
      mode: "plan",
      sandboxLevel: "project-write",
      sandboxNetworkFirewall: true,
    },
  });
  const disabled = new Set<string>();
  let grant = true;
  const available = vi.fn(
    async (provider: ProviderName): Promise<string | null> =>
      provider === "claude"
        ? "haiku"
        : provider === "codex"
          ? "gpt-6-luna"
          : "openrouter/auto",
  );
  const options = {
    dataDir: dir,
    eventBus: bus,
    enabled: (id: string) => !disabled.has(id),
    available,
    source: async (id: string) => {
      if (!grant) throw new Error("grant revoked");
      const source = sources.get(id);
      if (!source) throw new Error("source absent");
      return source;
    },
    enqueue: async (
      record: Parameters<
        ConstructorParameters<typeof QuotaRecoveryService>[0]["enqueue"]
      >[0],
      source: QuotaRecoverySource,
      model: string,
    ) =>
      (
        await queue.createItem({
          projectId: pid,
          projectPath: source.projectPath,
          createdByUser: source.actor,
          request: {
            target: {
              ...source.launch,
              type: "new-session",
              provider: record.target,
              model,
            },
            message: { text: source.handoff, mode: source.launch.mode },
            createdFrom: {
              sessionId: record.sourceSessionId,
              quotaRecoveryId: record.id,
            },
          },
        })
      ).id,
    changed: vi.fn(),
  };
  const service = new QuotaRecoveryService(options);
  await service.initialize();
  cleanup.push(() => service.dispose());
  return {
    dir,
    bus,
    queue,
    sources,
    disabled,
    available,
    options,
    service,
    revoke: () => {
      grant = false;
    },
  };
}
it("claims a repeated quota event once and durably queues the original task and launch boundary", async () => {
  const f = await fixture();
  await Promise.all([
    f.service.observe("source", pid, failure("claude")),
    f.service.observe("source", pid, failure("claude")),
  ]);
  await f.service.observe("source", pid, failure("claude"));
  const items = f.queue.listAll();
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    createdByUser: "marker",
    target: {
      provider: "codex",
      model: "gpt-6-luna",
      mode: "plan",
      sandboxLevel: "project-write",
      sandboxNetworkFirewall: true,
    },
    message: { text: "EXACT_CURRENT_TASK" },
  });
  const ledger = await readFile(join(f.dir, "quota-recovery.json"), "utf8");
  expect(ledger).not.toContain("EXACT_CURRENT_TASK");
  expect(ledger).not.toContain("SECRET_NOT_FOR_LEDGER");
});
it("moves Claude to Codex to Requesty once, then stops even after a coordinator restart", async () => {
  const f = await fixture();
  await f.service.observe("source", pid, failure("claude"));
  const one = f.queue.listAll()[0];
  expect(one).toBeDefined();
  if (!one) return;
  expect(await f.service.associate(one, "codex-next")).toBe(true);
  f.sources.set("codex-next", {
    ...f.sources.get("source")!,
    provider: "codex",
    turnKey: "handoff-1",
  });
  await f.service.dispose();
  const restarted = new QuotaRecoveryService(f.options);
  await restarted.initialize();
  cleanup.push(() => restarted.dispose());
  await restarted.observe("source", pid, failure("claude"));
  expect(f.queue.listAll()).toHaveLength(1);
  await restarted.observe("codex-next", pid, failure("codex"));
  const two = f.queue.listAll()[1];
  expect(two?.target.provider).toBe("codex-oss");
  if (!two) return;
  expect(await restarted.associate(two, "requesty-next")).toBe(true);
  f.sources.set("requesty-next", {
    ...f.sources.get("source")!,
    provider: "codex-oss",
    turnKey: "handoff-2",
  });
  await restarted.observe("requesty-next", pid, failure("codex-oss"));
  expect(f.queue.listAll()).toHaveLength(2);
  expect(restarted.getStatus("requesty-next")?.status).toBe("blocked");
});
it("uses Requesty last if the other CLI is unavailable, without returning to that CLI later", async () => {
  const f = await fixture();
  f.available.mockImplementation(async (p) =>
    p === "codex" ? null : "openrouter/auto",
  );
  await f.service.observe("source", pid, failure("claude"));
  const item = f.queue.listAll()[0];
  expect(item?.target.provider).toBe("claude-gateway");
  if (!item) return;
  await f.service.associate(item, "requesty");
  f.sources.set("requesty", {
    ...f.sources.get("source")!,
    provider: "claude-gateway",
    turnKey: "last",
  });
  f.available.mockImplementation(async () => "gpt-6-luna");
  await f.service.observe("requesty", pid, failure("claude-gateway"));
  expect(f.queue.listAll()).toHaveLength(1);
});
it("does nothing for manual chats or retrying statuses", async () => {
  const f = await fixture();
  f.disabled.add("source");
  await f.service.observe("source", pid, failure("claude"));
  expect(f.available).not.toHaveBeenCalled();
  expect(f.queue.listAll()).toHaveLength(0);
});
it.each(["output", "media", "budget"])(
  "stops on %s rather than replaying work or bypassing policy",
  async (kind) => {
    const f = await fixture();
    const source = f.sources.get("source")!;
    source.hasPartialActivity = kind === "output";
    source.hasInlineMedia = kind === "media";
    const status = failure("claude");
    if (status?.kind === "terminal" && kind === "budget")
      status.message = "Employee daily model budget exhausted";
    await f.service.observe("source", pid, status);
    expect(f.queue.listAll()).toHaveLength(0);
    expect(f.service.getStatus("source")?.status).toBe("blocked");
  },
);
it("validates cancellation, fresh grants and a newer source turn before queued dispatch", async () => {
  const f = await fixture();
  await f.service.observe("source", pid, failure("claude"));
  const item = f.queue.listAll()[0];
  if (!item) throw new Error("missing item");
  expect(await f.service.validate(item)).toBeNull();
  f.disabled.add("source");
  expect(await f.service.validate(item)).toBeTruthy();
  f.disabled.clear();
  f.sources.get("source")!.turnKey = "new-human-request";
  expect(await f.service.validate(item)).toBeTruthy();
  f.revoke();
  await expect(f.service.validate(item)).rejects.toThrow("grant revoked");
});
it("reacts to a server event without any connected browser", async () => {
  const f = await fixture();
  f.bus.emit({
    type: "provider-runtime-status-changed",
    sessionId: "source",
    projectId: pid,
    providerRuntimeStatus: failure("claude"),
    timestamp: new Date().toISOString(),
  });
  await vi.waitFor(() => expect(f.queue.listAll()).toHaveLength(1));
});
it("keeps an association made before the queue receipt and cannot replay it after restart", async () => {
  const f = await fixture();
  await f.service.dispose();
  let service: QuotaRecoveryService;
  const options = {
    ...f.options,
    enqueue: async (...args: Parameters<typeof f.options.enqueue>) => {
      const id = await f.options.enqueue(...args);
      const item = f.queue.listAll().find((item) => item.id === id)!;
      await service.associate(item, "early-successor");
      return id;
    },
  };
  service = new QuotaRecoveryService(options);
  await service.initialize();
  cleanup.push(() => service.dispose());
  await service.observe("source", pid, failure("claude"));
  expect(service.getStatus("source")).toMatchObject({
    status: "started",
    successorSessionId: "early-successor",
  });
  await service.dispose();
  const restarted = new QuotaRecoveryService(f.options);
  await restarted.initialize();
  cleanup.push(() => restarted.dispose());
  await restarted.observe("source", pid, failure("claude"));
  expect(f.queue.listAll()).toHaveLength(1);
});
it("does not revive a cancelled receipt when Auto is enabled again", async () => {
  const f = await fixture();
  await f.service.observe("source", pid, failure("claude"));
  const item = f.queue.listAll()[0]!;
  await f.service.cancel("source");
  expect(await f.service.validate(item)).toBeTruthy();
  await f.service.observe("source", pid, failure("claude"));
  expect(f.queue.listAll()).toHaveLength(1);
});
