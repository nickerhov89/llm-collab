import http from "node:http";
import net from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { configuration, projectId, EXTERNAL_CHANNELS } from "./config.mjs";
import { credentialCoverage } from "./accounts.mjs";
import { createStore } from "./store.mjs";
import { authorize, mutationGuard, HttpError } from "./authority.mjs";
import { BrowserService, stageUpload, validatePlan } from "./browser.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const securityHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
};
function json(res, status, data) {
  res.writeHead(status, {
    ...securityHeaders,
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new HttpError(415, "json_required");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new HttpError(413, "request_too_large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

export async function createService(config = configuration()) {
  process.umask(0o077);
  const store = await createStore(config);
  const browser = new BrowserService(config, store);
  const core = new URL(config.core);
  const proxy = (req, res) => {
    const upstream = http.request(
      {
        hostname: core.hostname,
        port: core.port,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) json(res, 502, { error: "cowork_unavailable" });
      else res.destroy();
    });
    req.on("aborted", () => upstream.destroy());
    res.on("close", () => {
      if (!res.writableEnded) upstream.destroy();
    });
    req.pipe(upstream);
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (!/^\/media(?:\/|$)/.test(url.pathname)) return proxy(req, res);
    try {
      if (config.origin && req.headers.host !== new URL(config.origin).host)
        throw new HttpError(403, "wrong_host");
      if (url.pathname === "/media/health" && req.method === "GET")
        return json(res, 200, {
          service: "polza-media-browser",
          version: "1.2.0",
        });
      if (
        url.pathname === "/media/console.js" ||
        url.pathname === "/media/console.css"
      ) {
        if (req.method !== "GET")
          throw new HttpError(405, "method_not_allowed");
        const name = url.pathname.split("/").at(-1);
        res.writeHead(200, {
          ...securityHeaders,
          "content-type": name.endsWith("js")
            ? "text/javascript; charset=utf-8"
            : "text/css; charset=utf-8",
        });
        return res.end(await fs.readFile(path.join(directory, name)));
      }
      const principal = await authorize(req, config, store);
      if (req.method === "POST") mutationGuard(req, config);
      else if (req.method !== "GET")
        throw new HttpError(405, "method_not_allowed");
      if (["/media", "/media/"].includes(url.pathname) && !principal.agent) {
        res.writeHead(200, {
          ...securityHeaders,
          "content-type": "text/html; charset=utf-8",
        });
        return res.end(await fs.readFile(path.join(directory, "console.html")));
      }
      const prefix = principal.agent ? "/media/agent" : "/media/api";
      const route = url.pathname.slice(prefix.length);
      if (!url.pathname.startsWith(`${prefix}/`))
        throw new HttpError(404, "not_found");
      if (route === "/status" && req.method === "GET") {
        const coverage = await credentialCoverage(config);
        return json(res, 200, {
          actor: principal.actor,
          maxBrowsers: config.maxBrowsers,
          projectId: projectId(config),
          sites: Object.entries(config.sites)
            .filter(([id]) => principal.sites.includes(id))
            .map(([id, site]) => {
              const entry = browser.entries.get(id);
              return {
                id,
                name: site.name,
                url: site.url,
                channel: site.channel || "cabinet",
                credentials: coverage[id],
                open: Boolean(entry),
                controller:
                  entry?.lease?.until > Date.now() ? entry.lease.actor : null,
              };
            }),
          externalChannels: EXTERNAL_CHANNELS,
          jobs: store
            .list()
            .filter((job) => principal.sites.includes(job.site)),
        });
      }
      if (route === "/agents" && req.method === "POST" && !principal.agent) {
        const grant = store.issue(principal.actor, principal.sites);
        const location = path.join(config.state, "agents");
        await fs.mkdir(location, { recursive: true, mode: 0o700 });
        const file = path.join(location, `${principal.actor}.json`);
        await fs.writeFile(
          file,
          JSON.stringify(
            {
              ...grant,
              origin: config.origin || `https://${req.headers.host}`,
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
        return json(res, 200, {
          actor: grant.actor,
          expires: grant.expires,
          config: file,
          command: `polza-media --actor ${grant.actor} status`,
        });
      }
      if (
        route === "/agents/revoke" &&
        req.method === "POST" &&
        !principal.agent
      ) {
        store.revoke(principal.actor);
        await fs.rm(
          path.join(config.state, "agents", `${principal.actor}.json`),
          { force: true },
        );
        return json(res, 200, { revoked: true });
      }
      if (route === "/jobs" && req.method === "POST") {
        const input = await body(req);
        validatePlan(config, input);
        if (!principal.sites.includes(input.site))
          throw new HttpError(403, "site_access_denied");
        const staging = randomUUID();
        try {
          for (const [index, step] of input.steps.entries()) {
            if (step.type === "upload")
              step.path = await stageUpload(config, step.path, staging, index);
          }
          const job = store.add(principal.actor, input);
          if (job.duplicate)
            await fs.rm(path.join(config.state, "uploads", staging), {
              recursive: true,
              force: true,
            });
          json(res, 202, job);
          void browser.tick().catch(() => {});
          return;
        } catch (error) {
          await fs.rm(path.join(config.state, "uploads", staging), {
            recursive: true,
            force: true,
          });
          throw error;
        }
      }
      const jobMatch =
        /^\/jobs\/([a-f0-9-]{36})(?:\/(cancel|evidence|resume))?$/.exec(route);
      if (jobMatch) {
        const job = store.get(jobMatch[1]);
        if (!job || !principal.sites.includes(job.site))
          throw new HttpError(404, "not_found");
        if (jobMatch[2] === "resume" && req.method === "POST") {
          await browser.resume(job);
          json(res, 202, { id: job.id, resumed: true });
          void browser.tick().catch(() => {});
          return;
        }
        if (jobMatch[2] === "cancel" && req.method === "POST") {
          if (job.status !== "queued")
            throw new HttpError(409, "only_queued_jobs_can_be_cancelled");
          store.update(job.id, "cancelled", { reason: "cancelled_by_user" });
          return json(res, 200, { cancelled: true });
        }
        if (jobMatch[2] === "evidence" && req.method === "GET") {
          if (!job.result?.evidence) throw new HttpError(404, "no_evidence");
          res.writeHead(200, {
            ...securityHeaders,
            "content-type": "image/jpeg",
          });
          return res.end(
            await fs.readFile(
              path.join(config.state, "evidence", `${job.id}.jpg`),
            ),
          );
        }
        if (!jobMatch[2] && req.method === "GET") {
          // Plans can contain article text. Deliberately omit all entered field values.
          return json(res, 200, {
            ...job,
            plan: job.plan.map(({ type, selector }) => ({ type, selector })),
          });
        }
      }
      const match =
        /^\/sites\/([a-z]+)\/(open|snapshot|frame|lease|release|input|close|file|login)$/.exec(
          route,
        );
      if (!match || !principal.sites.includes(match[1]))
        throw new HttpError(404, "not_found");
      const [, siteId, action] = match;
      if (action === "open" && req.method === "POST") {
        const input = await body(req);
        const entry = await browser.open(siteId);
        if (input.url)
          await browser.navigate(entry, principal.actor, input.url);
        return json(res, 200, { opened: true });
      }
      const entry = browser.entries.get(siteId);
      if (!entry) throw new HttpError(409, "open_browser_first");
      if (action === "login" && req.method === "POST")
        return json(res, 200, await browser.login(entry, principal.actor));
      if (action === "snapshot" && req.method === "GET")
        return json(res, 200, await browser.status(entry));
      if (action === "frame" && req.method === "GET" && !principal.agent) {
        res.writeHead(200, {
          ...securityHeaders,
          "content-type": "image/jpeg",
        });
        return res.end(await browser.frame(entry));
      }
      if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
      if (action === "file" && !principal.agent) {
        const client = req.headers["x-media-client"];
        browser.controls(entry, principal.actor, client);
        if (!entry.fileChooser || entry.fileChooser.until < Date.now())
          throw new HttpError(409, "click_file_field_first");
        const name = decodeURIComponent(req.headers["x-media-filename"] || "");
        if (!/\.(png|jpe?g|webp|gif|pdf|docx)$/i.test(name))
          throw new HttpError(400, "unsupported_upload_type");
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 15 * 1024 * 1024)
            throw new HttpError(413, "upload_limit_15mb");
          chunks.push(chunk);
        }
        if (!size) throw new HttpError(400, "empty_file");
        const uploads = path.join(config.state, "manual-uploads");
        await fs.mkdir(uploads, { recursive: true, mode: 0o700 });
        const file = path.join(
          uploads,
          `${randomUUID()}${path.extname(name).toLowerCase()}`,
        );
        await fs.writeFile(file, Buffer.concat(chunks), { mode: 0o600 });
        await browser.serial(entry, async () => {
          browser.controls(entry, principal.actor, client);
          await entry.fileChooser.chooser.setFiles(file);
          entry.fileChooser = null;
        });
        return json(res, 200, { uploaded: true });
      }
      const input = await body(req);
      if (principal.agent && action === "close") {
        if (entry.lease?.until > Date.now())
          throw new HttpError(409, "browser_has_controller");
        await entry.context.close();
        return json(res, 200, { closed: true });
      }
      if (principal.agent) throw new HttpError(403, "agents_use_durable_jobs");
      if (action === "lease")
        return json(
          res,
          200,
          browser.lease(
            entry,
            principal.actor,
            input.client,
            input.takeover === true,
          ),
        );
      if (action === "release") {
        await browser.release(entry, principal.actor, input.client);
        return json(res, 200, { released: true });
      }
      if (action === "input")
        await browser.input(entry, principal.actor, input.client, input.action);
      else if (action === "close")
        await browser.closeSite(siteId, principal.actor, input.client);
      else throw new HttpError(404, "not_found");
      return json(res, 200, { ok: true });
    } catch (error) {
      if (!res.headersSent)
        json(res, error.status || 503, {
          error:
            error instanceof HttpError ? error.message : "operation_failed",
        });
      else res.destroy();
    }
  });
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (req, socket, head) => {
    if (/^\/media(?:\/|$)/.test(req.url)) return socket.destroy();
    const upstream = net.connect(Number(core.port || 80), core.hostname, () => {
      upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
      for (let i = 0; i < req.rawHeaders.length; i += 2)
        upstream.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
      upstream.write("\r\n");
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
  });
  const tick = setInterval(() => void browser.tick().catch(() => {}), 4000);
  tick.unref();
  let stopped = false;
  return {
    server,
    browser,
    store,
    async close() {
      if (stopped) return;
      stopped = true;
      clearInterval(tick);
      await browser.close();
      // Closing contexts aborts in-flight operations; wait until their final status is durable.
      while (browser.running)
        await new Promise((resolve) => setTimeout(resolve, 20));
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
        for (const socket of sockets) socket.destroy();
      });
      store.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = configuration();
  const service = await createService(config);
  service.server.listen(config.port, "127.0.0.1", () =>
    console.info(`Polza Media Browser listening on 127.0.0.1:${config.port}`),
  );
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      await service.close();
      process.exit(0);
    });
}
