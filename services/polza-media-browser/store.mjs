import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");

export async function createStore(config, { recover = true } = {}) {
  await fs.mkdir(config.state, { recursive: true, mode: 0o700 });
  await fs.chmod(config.state, 0o700);
  const { openSqliteOrThrow } = await import(pathToFileURL(config.sqlite).href);
  const db = openSqliteOrThrow(path.join(config.state, "media.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, actor TEXT NOT NULL, site TEXT NOT NULL,
      intent TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
      plan TEXT NOT NULL, result TEXT, created INTEGER NOT NULL,
      updated INTEGER NOT NULL, idem TEXT NOT NULL, UNIQUE(actor, idem));
    CREATE TABLE IF NOT EXISTS tokens (
      hash TEXT PRIMARY KEY, actor TEXT NOT NULL, sites TEXT NOT NULL,
      created INTEGER NOT NULL, expires INTEGER NOT NULL);`);
  if (recover)
    db.exec(
      "UPDATE jobs SET status='needs_review', result='{\"reason\":\"service_restarted_no_replay\"}' WHERE status='running'",
    );
  await fs.chmod(path.join(config.state, "media.sqlite"), 0o600);
  const sql = {
    jobs: db.prepare(
      "SELECT id,actor,site,intent,title,status,result,created,updated FROM jobs ORDER BY created DESC LIMIT 100",
    ),
    job: db.prepare("SELECT * FROM jobs WHERE id=?"),
    idem: db.prepare("SELECT id FROM jobs WHERE actor=? AND idem=?"),
    add: db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,NULL,?,?,?)"),
    update: db.prepare(
      "UPDATE jobs SET status=?,result=?,updated=? WHERE id=?",
    ),
    pending: db.prepare(
      "SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 100",
    ),
    token: db.prepare("SELECT * FROM tokens WHERE hash=? AND expires>?"),
    revoke: db.prepare("DELETE FROM tokens WHERE actor=?"),
    addToken: db.prepare("INSERT INTO tokens VALUES(?,?,?,?,?)"),
  };
  const decode = (row) =>
    row
      ? {
          ...row,
          plan: row.plan ? JSON.parse(row.plan) : undefined,
          result: row.result ? JSON.parse(row.result) : null,
        }
      : null;
  return {
    list: () => sql.jobs.all().map(decode),
    get: (id) => decode(sql.job.get(id)),
    pending: () => sql.pending.all().map(decode),
    add(actor, body) {
      const previous = sql.idem.get(actor, body.idempotencyKey);
      if (previous) return { id: previous.id, duplicate: true };
      const id = randomUUID();
      const now = Date.now();
      sql.add.run(
        id,
        actor,
        body.site,
        body.intent,
        body.title,
        "queued",
        JSON.stringify(body.steps),
        now,
        now,
        body.idempotencyKey,
      );
      return { id, duplicate: false };
    },
    update(id, status, result) {
      sql.update.run(status, JSON.stringify(result), Date.now(), id);
    },
    issue(actor, sites) {
      const token = randomBytes(32).toString("base64url");
      const expires = Date.now() + 30 * 86_400_000;
      db.transaction(() => {
        sql.revoke.run(actor);
        sql.addToken.run(
          digest(token),
          actor,
          JSON.stringify(sites),
          Date.now(),
          expires,
        );
      });
      return { token, expires, actor, sites };
    },
    token(value) {
      const row = sql.token.get(digest(value), Date.now());
      return row ? { actor: row.actor, sites: JSON.parse(row.sites) } : null;
    },
    revoke(actor) {
      sql.revoke.run(actor);
    },
    close() {
      for (const s of Object.values(sql)) s.finalize();
      db.close();
    },
  };
}
