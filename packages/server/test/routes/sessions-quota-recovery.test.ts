import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type {
  LimitedUserGrants,
  ProviderRuntimeStatus,
} from "@yep-anywhere/shared";
import { encodeProjectId } from "../../src/projects/paths.js";
import {
  createSessionsRoutes,
  type SessionsDeps,
} from "../../src/routes/sessions.js";
import * as providers from "../../src/sdk/providers/index.js";
import { ProjectQueueService } from "../../src/services/ProjectQueueService.js";
import type { QuotaRecoveryService } from "../../src/services/QuotaRecoveryService.js";
import type { Project } from "../../src/supervisor/types.js";
import { EventBus } from "../../src/watcher/EventBus.js";
import {
  closeTestDiscoveryDatabases,
  createTestSessionMetadataService,
} from "../utils/session-metadata-database.js";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  closeTestDiscoveryDatabases();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("reconstructs buffered input with its actual sender and sandbox; rechecks grants", async () => {
  vi.stubEnv("POLZA_AUTO_QUOTA_RECOVERY", "1");
  const dir = await mkdtemp(join(tmpdir(), "quota-route-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const projectPath = join(dir, "project");
  const pid = encodeProjectId(projectPath);
  const project = {
    id: pid,
    path: projectPath,
    provider: "claude",
    sessionDir: join(dir, "transcripts"),
    name: "QA",
  } as Project;
  const metadata = createTestSessionMetadataService(join(dir, "metadata"));
  await metadata.initialize();
  await metadata.updateMetadata("source", { quotaFailoverEnabled: true });
  await metadata.recordSessionCreator("source", "creator");
  await metadata.setSessionSandbox("source", {
    level: "project-write",
    projectPath,
    projectId: pid,
    networkFirewall: true,
  });
  const bus = new EventBus();
  const queue = new ProjectQueueService({
    dataDir: join(dir, "queue"),
    eventBus: bus,
  });
  await queue.initialize();
  const history = [
    {
      type: "user",
      uuid: "latest-task",
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "Research the records. EXACT_REQUEST" },
      messageMetadata: {
        serverReceivedAt: new Date().toISOString(),
        sentByUser: "marker",
      },
    },
  ];
  const pause = vi.fn(async () => {});
  const process = {
    id: "qa-process",
    sessionId: "source",
    provider: "claude",
    projectId: pid,
    projectPath,
    permissionMode: "plan",
    getMessageHistory: () => history,
  };
  let grants: LimitedUserGrants | undefined = {
    newSessionProjects: [pid],
    joinProjects: [],
    viewProjects: [],
    joinStaleOffsetMinutes: 0,
    lock: {},
  };
  vi.spyOn(providers, "getProvider").mockReturnValue({
    getAuthStatus: async () => ({
      installed: true,
      authenticated: true,
      enabled: true,
    }),
    getAvailableModels: async () => [{ id: "gpt-6-luna" }],
  } as never);
  const reader = {
    getSessionListSummary: async () => null,
    getSessionSummary: async () => null,
    getSessionFilePath: async () => null,
    listSessions: async () => [],
    getSession: async () => null,
  };
  let recovery: QuotaRecoveryService | undefined;
  let ready: Promise<void> | undefined;
  createSessionsRoutes({
    dataDir: dir,
    eventBus: bus,
    projectQueueService: queue,
    sessionMetadataService: metadata,
    scanner: {
      getOrCreateProject: async () => project,
    } as unknown as SessionsDeps["scanner"],
    readerFactory: () =>
      reader as unknown as ReturnType<SessionsDeps["readerFactory"]>,
    supervisor: {
      getProcessForSession: () => process,
      pauseSessionAutomation: pause,
    } as unknown as SessionsDeps["supervisor"],
    getLimitedUserGrants: (user) => (user === "marker" ? grants : undefined),
    onQuotaRecoveryCreated: (service, initialized) => {
      recovery = service;
      ready = initialized;
    },
  });
  await ready;
  if (!recovery) throw new Error("not initialized");
  const service: QuotaRecoveryService = recovery;
  cleanup.push(() => service.dispose());
  const failure: ProviderRuntimeStatus = {
    kind: "terminal",
    reason: "rate_limit",
    provider: "claude",
    message: "You’ve hit your usage limit",
    source: "fixture",
    occurredAt: new Date().toISOString(),
  };
  await service.observe("source", pid, failure);
  expect(queue.listAll()).toHaveLength(1);
  const item = queue.listAll()[0]!;
  expect(item.createdByUser).toBe("marker");
  expect(item.target).toMatchObject({
    provider: "codex",
    mode: "plan",
    sandboxLevel: "project-write",
    sandboxNetworkFirewall: true,
  });
  expect(item.message.text).toContain("EXACT_REQUEST");
  expect(pause).toHaveBeenCalledOnce();
  expect(await service.validate(item)).toBeNull();
  grants = undefined;
  await expect(service.validate(item)).rejects.toThrow("grant");
  grants = {
    newSessionProjects: [pid],
    joinProjects: [],
    viewProjects: [],
    joinStaleOffsetMinutes: 0,
    lock: {},
  };
  history.push({
    type: "user",
    uuid: "image-only",
    timestamp: new Date().toISOString(),
    message: { role: "user", content: [{ type: "image" }] },
    messageMetadata: {
      serverReceivedAt: new Date().toISOString(),
      sentByUser: "marker",
    },
  } as unknown as (typeof history)[number]);
  await service.observe("source", pid, {
    ...failure,
    occurredAt: new Date().toISOString(),
  });
  expect(service.getStatus("source")).toMatchObject({ status: "blocked" });
  expect(queue.listAll()).toHaveLength(1);
  await metadata.updateMetadata("source", {
    quotaFailoverActor: null,
    quotaFailoverActorKnown: true,
    quotaFailoverTurnId: "different-old-turn",
  });
  history.push({
    type: "user",
    uuid: "unknown-sender",
    timestamp: new Date().toISOString(),
    message: { role: "user", content: "Do not impersonate the owner" },
  } as unknown as (typeof history)[number]);
  await service.observe("source", pid, {
    ...failure,
    occurredAt: new Date().toISOString(),
  });
  expect(queue.listAll()).toHaveLength(1);
});
