import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { PRINCIPAL_VARIABLE, type Principal } from "../auth/principal.js";

const MAX_BYTES = 5_000_000;
interface TaskerState {
  revision: number;
  data: Record<string, unknown>;
}
const empty = (): TaskerState => ({
  revision: 0,
  data: { version: 1, tasks: [] },
});
function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function validData(v: unknown): v is Record<string, unknown> {
  if (
    !record(v) ||
    v.version !== 1 ||
    !Array.isArray(v.tasks) ||
    v.tasks.length > 5000
  )
    return false;
  const ids = new Set<string>();
  for (const t of v.tasks) {
    if (
      !record(t) ||
      typeof t.id !== "string" ||
      !t.id ||
      t.id.length > 512 ||
      ids.has(t.id) ||
      typeof t.title !== "string" ||
      !t.title.trim() ||
      t.title.length > 2000 ||
      (t.note !== undefined &&
        (typeof t.note !== "string" || t.note.length > 50000)) ||
      (t.group !== undefined &&
        (typeof t.group !== "string" || t.group.length > 100)) ||
      ["done", "today", "deleted"].some(
        (k) => t[k] !== undefined && typeof t[k] !== "boolean",
      ) ||
      (t.priority !== undefined && !record(t.priority))
    )
      return false;
    ids.add(t.id);
  }
  if (v.profile !== undefined) {
    if (!record(v.profile)) return false;
    for (const k of ["level", "xp", "maxXp", "hp", "maxHp", "gold"]) {
      const n = v.profile[k];
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return false;
    }
  }
  return true;
}

export function createPolzaTaskerRoutes(dataDir: string) {
  const app = new Hono<{ Variables: { yaPrincipal: Principal } }>();
  const directory = join(dataDir, "polza-tasker");
  // Only in-flight writes have a lock entry; every settled request releases it.
  const writes = new Map<string, Promise<void>>();
  const fileFor = (account: string) =>
    join(
      directory,
      `${createHash("sha256").update(account).digest("hex")}.json`,
    );
  async function read(account: string): Promise<TaskerState> {
    try {
      const value: unknown = JSON.parse(
        await fs.readFile(fileFor(account), "utf8"),
      );
      if (
        !record(value) ||
        !Number.isSafeInteger(value.revision) ||
        (value.revision as number) < 1 ||
        !validData(value.data)
      )
        throw new Error("Invalid stored Tasker data");
      return value as unknown as TaskerState;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw e;
    }
  }
  app.use("*", bodyLimit({ maxSize: MAX_BYTES }));
  app.use("*", async (c, next) => {
    if (!c.get(PRINCIPAL_VARIABLE))
      return c.json({ error: "Authentication required" }, 401);
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.get("/", async (c) => {
    const p = c.get(PRINCIPAL_VARIABLE) as Principal;
    const accountKey = p.kind === "limited" ? `user:${p.username}` : "owner";
    try {
      return c.json({ ...(await read(accountKey)), accountKey });
    } catch {
      return c.json(
        { error: "Tasker storage unavailable; existing data was kept" },
        503,
      );
    }
  });
  app.put("/", async (c) => {
    const p = c.get(PRINCIPAL_VARIABLE) as Principal;
    const accountKey = p.kind === "limited" ? `user:${p.username}` : "owner";
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    if (
      !record(body) ||
      !Number.isSafeInteger(body.revision) ||
      (body.revision as number) < 0 ||
      !validData(body.data)
    )
      return c.json({ error: "Invalid Tasker data" }, 400);
    // This is an identity fence, never an account selector supplied by a client.
    if (body.accountKey !== accountKey)
      return c.json(
        { error: "Tasker account changed; reload before saving" },
        409,
      );
    const previous = writes.get(accountKey) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    writes.set(accountKey, tail);
    await previous;
    let stage: string | undefined;
    try {
      const current = await read(accountKey);
      if (body.revision !== current.revision)
        return c.json(
          {
            error:
              "Tasker changed in another tab; export your edits before reloading",
          },
          409,
        );
      const next = { revision: current.revision + 1, data: body.data };
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.chmod(directory, 0o700);
      stage = join(directory, `.${randomUUID()}.tmp`);
      const handle = await fs.open(stage, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(next));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(stage, fileFor(accountKey));
      return c.json({ ...next, accountKey });
    } catch {
      return c.json(
        { error: "Tasker save failed; existing data was kept" },
        503,
      );
    } finally {
      if (stage) await fs.unlink(stage).catch(() => {});
      release();
      if (writes.get(accountKey) === tail) writes.delete(accountKey);
    }
  });
  return app;
}
