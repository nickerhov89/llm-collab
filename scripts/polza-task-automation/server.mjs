import http from "node:http";
import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { AutomationEngine } from "./engine.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
export async function startAutomationServer(config) {
  const accounts = config.accounts;
  const capabilities = new Map(
    Object.entries(accounts).map(([name, r]) => [hash(r.token), name]),
  );
  const engine = new AutomationEngine({
    accounts,
    directory: config.directory,
  });
  await fs.mkdir(config.directory, { recursive: true, mode: 0o700 });
  const lock = join(config.directory, "server.lock");
  try {
    const fd = await fs.open(lock, "wx", 0o600);
    await fd.writeFile(String(process.pid));
    await fd.close();
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const pid = Number(await fs.readFile(lock, "utf8"));
    if (!Number.isSafeInteger(pid) || pid < 2)
      throw Error("Invalid scheduler lock");
    try {
      process.kill(pid, 0);
      throw Error("A scheduler already owns this store");
    } catch (probe) {
      if (probe.code !== "ESRCH") throw probe;
    }
    await fs.unlink(lock);
    const fd = await fs.open(lock, "wx", 0o600);
    await fd.writeFile(String(process.pid));
    await fd.close();
  }
  await fs.mkdir(dirname(config.socket), { recursive: true, mode: 0o755 });
  await fs.unlink(config.socket).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
  const server = http.createServer(async (req, res) => {
    const reply = (status, value) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    const account = capabilities.get(
      hash(req.headers.authorization?.replace(/^Bearer /, "") ?? ""),
    );
    if (!account || req.method !== "POST" || req.url !== "/call")
      return reply(403, { error: "Automation access denied" });
    let size = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 262144) return reply(413, { error: "Request too large" });
        chunks.push(chunk);
      }
      const request = JSON.parse(Buffer.concat(chunks).toString());
      const expected = accounts[account].username ?? "superuser";
      if (
        request.principal !== expected &&
        !(accounts[account].username && request.principal === "superuser")
      )
        return reply(403, { error: "Account mismatch" });
      const result = await engine.handle(account, request);
      reply(200, result);
    } catch (e) {
      reply(e.status ?? 400, {
        error: e.message?.slice(0, 300) ?? "Automation unavailable",
      });
    }
  });
  server.maxConnections = 16;
  server.requestTimeout = 60000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.socket, resolve);
  });
  await fs.chmod(config.socket, 0o666);
  await engine.start();
  return {
    engine,
    server,
    async close() {
      const closing = new Promise((resolve) => server.close(resolve));
      await engine.stop();
      await closing;
      await fs.unlink(config.socket).catch(() => {});
      await fs.unlink(lock).catch(() => {});
    },
  };
}
if (process.env.POLZA_TASK_AUTOMATION_CONFIG) {
  const file = process.env.POLZA_TASK_AUTOMATION_CONFIG;
  const st = await fs.lstat(file);
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== 0 || st.mode & 0o027)
    throw Error("Scheduler config must be root-owned and private");
  const instance = await startAutomationServer(
    JSON.parse(await fs.readFile(file, "utf8")),
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await instance.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
  console.log(
    JSON.stringify({ event: "task_automation_ready", instance: randomUUID() }),
  );
}
