import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ProjectQueueItem,
  ProjectQueueTarget,
  ProviderName,
  ProviderRuntimeStatus,
  UrlProjectId,
} from "@yep-anywhere/shared";
import type { EventBus } from "../watcher/EventBus.js";

export type QuotaFamily = "claude" | "codex" | "requesty";
export interface QuotaRecoveryRecord {
  id: string;
  sourceSessionId: string;
  projectId: UrlProjectId;
  turnKey: string;
  tried: QuotaFamily[];
  status: "preparing" | "queued" | "started" | "blocked";
  target?: ProviderName;
  queueId?: string;
  successorSessionId?: string;
  reason?: string;
  actor?: string;
  cancelled?: boolean;
}
export interface QuotaRecoverySource {
  turnKey: string;
  provider: ProviderName;
  projectPath: string;
  actor?: string;
  hasPartialActivity: boolean;
  hasInlineMedia: boolean;
  handoff: string;
  launch: Omit<
    Extract<ProjectQueueTarget, { type: "new-session" }>,
    "type" | "provider" | "model"
  >;
}
interface Options {
  dataDir: string;
  eventBus: EventBus;
  enabled: (sessionId: string) => boolean;
  source: (
    sessionId: string,
    projectId: UrlProjectId,
    failure?: ProviderRuntimeStatus,
  ) => Promise<QuotaRecoverySource>;
  available: (provider: ProviderName) => Promise<string | null>;
  enqueue: (
    record: QuotaRecoveryRecord,
    source: QuotaRecoverySource,
    model: string,
  ) => Promise<string>;
  changed: (record: QuotaRecoveryRecord) => void;
}
const family = (provider: ProviderName): QuotaFamily | null =>
  provider === "claude"
    ? "claude"
    : provider === "codex"
      ? "codex"
      : provider === "claude-gateway" || provider === "codex-oss"
        ? "requesty"
        : null;

/** Event driven; no polling, paid probes, browser owner or retained prompts. */
export class QuotaRecoveryService {
  private records: Record<string, QuotaRecoveryRecord> = {};
  private inherited: Record<
    string,
    { tried: QuotaFamily[]; turnKey?: string }
  > = {};
  private inFlight = new Map<string, Promise<void>>();
  private writes: Promise<void> = Promise.resolve();
  private unsubscribe?: () => void;
  private closed = false;
  constructor(private options: Options) {}
  async initialize(): Promise<void> {
    await mkdir(this.options.dataDir, { recursive: true, mode: 0o700 });
    try {
      const stored = JSON.parse(
        await readFile(
          join(this.options.dataDir, "quota-recovery.json"),
          "utf8",
        ),
      );
      this.records = stored.records ?? {};
      this.inherited = stored.inherited ?? {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // An uncertain launch is never replayed after a crash. Durable queued
    // items still belong to the existing Project Queue scheduler.
    for (const record of Object.values(this.records)) {
      if (record.status === "preparing") {
        record.status = "blocked";
        record.reason =
          "Recovery was interrupted before its queue receipt; review the queue before retrying.";
      }
    }
    await this.save();
    this.unsubscribe = this.options.eventBus.subscribe((event) => {
      if (event.type === "project-queue-changed") {
        for (const record of Object.values(this.records)) {
          if (
            record.status !== "queued" ||
            record.projectId !== event.projectId
          )
            continue;
          const item = event.items.find((item) => item.id === record.queueId);
          if (item?.status === "failed") {
            record.status = "blocked";
            record.reason =
              "Recovery could not start with the current permissions, model or launch boundary. The original task is preserved.";
            void this.save().then(() => this.options.changed(record));
          }
        }
      }
      if (
        event.type === "provider-runtime-status-changed" &&
        event.providerRuntimeStatus?.kind === "terminal"
      )
        void this.observe(
          event.sessionId,
          event.projectId,
          event.providerRuntimeStatus,
        );
    });
  }
  getStatus(
    sessionId: string,
  ): import("@yep-anywhere/shared").QuotaRecoveryStatus | undefined {
    const row = this.records[sessionId];
    return row
      ? {
          status: row.status,
          target: row.target,
          successorSessionId: row.successorSessionId,
          reason: row.reason,
        }
      : undefined;
  }

  observe(
    sessionId: string,
    projectId: UrlProjectId,
    failure: ProviderRuntimeStatus,
  ): Promise<void> {
    if (
      this.closed ||
      failure?.kind !== "terminal" ||
      failure.reason !== "rate_limit" ||
      !this.options.enabled(sessionId)
    )
      return Promise.resolve();
    const existing = this.inFlight.get(sessionId);
    if (existing) return existing;
    const work = this.recover(sessionId, projectId, failure)
      .catch(async () => {
        const record = this.records[sessionId];
        if (record && record.status !== "started") {
          record.status = "blocked";
          record.reason =
            "Automatic quota recovery could not be completed. The source chat is preserved.";
          await this.save();
          this.options.changed(record);
        }
      })
      .finally(() => this.inFlight.delete(sessionId));
    this.inFlight.set(sessionId, work);
    return work;
  }
  private async recover(
    sessionId: string,
    projectId: UrlProjectId,
    failure: ProviderRuntimeStatus,
  ): Promise<void> {
    const source = await this.options.source(sessionId, projectId, failure);
    if (this.closed || !this.options.enabled(sessionId)) return;
    if (this.records[sessionId]?.turnKey === source.turnKey) return;
    const sourceFamily = family(source.provider);
    if (!sourceFamily) return;
    const inherited = this.inherited[sessionId];
    const tried = new Set<QuotaFamily>(
      inherited && (!inherited.turnKey || inherited.turnKey === source.turnKey)
        ? inherited.tried
        : [],
    );
    if (inherited && !inherited.turnKey) inherited.turnKey = source.turnKey;
    tried.add(sourceFamily);
    const record: QuotaRecoveryRecord = {
      id: randomUUID(),
      sourceSessionId: sessionId,
      projectId,
      turnKey: source.turnKey,
      tried: [...tried],
      status: "preparing",
      actor: source.actor,
    };
    this.records[sessionId] = record;
    // Persist the claim before any await that could create a new session.
    await this.save();
    this.options.changed(record);
    if (
      source.hasPartialActivity ||
      source.hasInlineMedia ||
      /employee|daily.{0,40}(?:budget|spend)|sessionBudgetExceeded|terms.of.service|content.policy/i.test(
        failure?.message ?? "",
      )
    ) {
      record.status = "blocked";
      record.reason = source.hasPartialActivity
        ? "The failed turn already produced output or tools; review its checkpoint before continuing."
        : source.hasInlineMedia
          ? "The latest request contains inline media; keep it attached during a manual handoff."
          : "This limit is an account policy or employee spending boundary; it cannot be bypassed by routing.";
      await this.save();
      this.options.changed(record);
      return;
    }
    const requestyWasLastResort = [...tried].indexOf("requesty") > 0;
    const candidates: ProviderName[] = requestyWasLastResort
      ? []
      : sourceFamily === "claude"
        ? ["codex", "claude-gateway"]
        : sourceFamily === "codex"
          ? ["claude", "codex-oss"]
          : ["claude", "codex"];
    for (const provider of candidates) {
      const nextFamily = family(provider);
      if (!nextFamily || tried.has(nextFamily)) continue;
      let model: string | null;
      try {
        model = await this.options.available(provider);
      } catch {
        continue;
      }
      if (!model) continue;
      if (this.closed || !this.options.enabled(sessionId)) return;
      record.target = provider;
      record.tried = [...tried, nextFamily];
      await this.save();
      const queueId = await this.options.enqueue(record, source, model);
      record.queueId = queueId;
      // Dispatch may have associated the successor before createItem returned.
      if (record.status === "preparing") record.status = "queued";
      await this.save();
      this.options.changed(record);
      return;
    }
    record.status = "blocked";
    record.reason =
      "All eligible CLI and Requesty routes are exhausted or unavailable.";
    await this.save();
    this.options.changed(record);
  }
  async cancel(sessionId: string): Promise<void> {
    const record = this.records[sessionId];
    if (!record || record.status === "started") return;
    record.cancelled = true;
    record.status = "blocked";
    record.reason = "Automatic recovery was disabled for this chat.";
    await this.save();
    this.options.changed(record);
  }
  async validate(item: ProjectQueueItem): Promise<string | null> {
    const id = item.createdFrom?.quotaRecoveryId;
    if (!id) return null;
    const record = Object.values(this.records).find((entry) => entry.id === id);
    if (
      !record ||
      record.cancelled ||
      record.successorSessionId ||
      !this.options.enabled(record.sourceSessionId)
    )
      return "Quota recovery is no longer eligible.";
    const source = await this.options.source(
      record.sourceSessionId,
      record.projectId,
    );
    return source.turnKey === record.turnKey &&
      source.actor === item.createdByUser
      ? null
      : "The source task changed before quota recovery could start.";
  }
  async associate(item: ProjectQueueItem, sessionId: string): Promise<boolean> {
    const id = item.createdFrom?.quotaRecoveryId;
    if (!id) return false;
    const record = Object.values(this.records).find((entry) => entry.id === id);
    if (
      !record ||
      record.actor !== item.createdByUser ||
      record.projectId !== item.projectId ||
      item.target.type !== "new-session" ||
      item.target.provider !== record.target
    )
      return false;
    if (record.successorSessionId && record.successorSessionId !== sessionId)
      return false;
    delete record.reason;
    record.reason = undefined;
    record.successorSessionId = sessionId;
    record.status = "started";
    this.inherited[sessionId] = { tried: record.tried };
    await this.save();
    this.options.changed(record);
    return true;
  }
  private save(): Promise<void> {
    const write = this.writes.then(async () => {
      const file = join(this.options.dataDir, "quota-recovery.json");
      await writeFile(
        file + ".next",
        JSON.stringify({ records: this.records, inherited: this.inherited }),
        { mode: 0o600 },
      );
      await rename(file + ".next", file);
    });
    this.writes = write.catch(() => {});
    return write;
  }
  async dispose(): Promise<void> {
    this.closed = true;
    this.unsubscribe?.();
    await Promise.allSettled(this.inFlight.values());
    await this.writes;
  }
}
