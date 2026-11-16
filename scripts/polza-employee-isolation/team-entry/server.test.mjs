import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fork } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { randomBytes } from "node:crypto";

test("isolated sign-in handoff, no owner fallback, admin authorization", async (t) => {
  const servers = [],
    sessions = new Map();
  let patch;
  async function backend(name, host) {
    const server = http.createServer(async (req, res) => {
      assert.equal(req.headers.host, host);
      assert.equal(req.headers.origin, "https://" + host);
      res.setHeader("content-type", "application/json");
      let data = "";
      for await (const chunk of req) data += chunk;
      const input = data ? JSON.parse(data) : {};
      const session = sessions.get(req.headers.cookie);
      if (req.url === "/api/auth/login") {
        const valid =
          (!input.username && input.password === name + "-admin") ||
          (name === "marker" &&
            input.username === "marker" &&
            input.password === "staff-password");
        if (!valid) {
          res.writeHead(401);
          return res.end("{}");
        }
        const token = randomBytes(32).toString("hex");
        sessions.set(
          "yep-anywhere-session=" + token,
          input.username || "owner",
        );
        res.setHeader(
          "set-cookie",
          "yep-anywhere-session=" +
            token +
            "; Path=/; Secure; HttpOnly; SameSite=Lax",
        );
        return res.end('{"success":true}');
      }
      if (!session) {
        res.writeHead(401);
        return res.end("{}");
      }
      if (req.url === "/api/auth/logout") {
        sessions.delete(req.headers.cookie);
        return res.end('{"success":true}');
      }
      if (req.url === "/") {
        res.setHeader("content-type", "text/html");
        return res.end('<div id="root"></div>');
      }
      if (req.url === "/api/users/me")
        return res.end(
          JSON.stringify({
            username: session === "owner" ? null : session,
            superuser: session === "owner",
            switched: false,
          }),
        );
      if (session !== "owner") {
        res.writeHead(403);
        return res.end("{}");
      }
      if (req.url === "/api/users")
        return res.end(
          JSON.stringify({
            users: [
              {
                username: "marker",
                disabled: false,
                newSessionProjects: ["project-marker"],
              },
            ],
          }),
        );
      if (req.url === "/api/users/marker" && req.method === "PATCH") {
        patch = input;
        return res.end('{"success":true}');
      }
      res.writeHead(404);
      res.end("{}");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    servers.push(server);
    return server.address().port;
  }
  const ownerPort = await backend("owner", "team.test"),
    markerPort = await backend("marker", "marker.test");
  const folder = await mkdtemp(join(tmpdir(), "polza-team-test-"));
  const file = join(folder, "config.json");
  await writeFile(
    file,
    JSON.stringify({
      realms: {
        owner: { host: "team.test", port: ownerPort },
        marker: {
          host: "marker.test",
          port: markerPort,
          label: "Маркетинг",
          adminPassword: "marker-admin",
        },
      },
    }),
    { mode: 0o600 },
  );
  const child = fork(new URL("./server.mjs", import.meta.url), {
    env: { ...process.env, TEAM_CONFIG: file, PORT: "0" },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    for (const s of servers) s.close();
    await rm(folder, { recursive: true, force: true });
  });
  const { port } = await new Promise((resolve, reject) => {
    child.once("message", resolve);
    child.once("exit", (code, signal) =>
      reject(Error(`Entry service exited before readiness: ${code ?? signal}`)),
    );
    child.once("error", reject);
  });
  async function call(
    path,
    { host = "team.test", body, session, origin = true } = {},
  ) {
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: body === undefined ? "GET" : "POST",
          headers: {
            host,
            ...(origin ? { origin: "https://" + host } : {}),
            ...(body === undefined
              ? {}
              : { "content-type": "application/json" }),
            ...(session ? { cookie: session } : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              json: async () => JSON.parse(data),
              headers: {
                get: (key) => res.headers[key] ?? null,
                getSetCookie: () => res.headers["set-cookie"] ?? [],
              },
            }),
          );
        },
      );
      request.on("error", reject);
      request.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  const login = async (username, password) =>
    call("/team/api/login", { body: { username, password } });
  assert.equal(
    (
      await call("/team/api/login", {
        body: { username: "marker", password: "staff-password" },
        origin: false,
      })
    ).status,
    403,
  );
  assert.equal((await login("unknown", "owner-admin")).status, 401);
  assert.equal(
    (await login("marker", "owner-admin")).status,
    401,
    "Owner password must not fall back under staff name",
  );
  let r = await login("marker", "staff-password");
  assert.equal(r.status, 200);
  const { next } = await r.json();
  const ticket = new URL(next).hash.slice(1);
  assert.equal(new URL(next).hostname, "marker.test");
  assert.equal(ticket.length, 64);
  assert(
    r.headers.getSetCookie().every((c) => c.includes("Max-Age=0")),
    "Only cleared cookies on owner origin",
  );
  assert.equal(
    (await call("/team-entry", { host: "team.test", body: { ticket } })).status,
    401,
    "Ticket must be bound to target host",
  );
  r = await call("/team-entry", { host: "marker.test", body: { ticket } });
  assert.equal(r.status, 200);
  assert.equal(
    (await r.json()).next,
    "/projects",
    "Staff lands on project overview rather than an arbitrary new session",
  );
  const cookies = r.headers.getSetCookie();
  const staff = cookies[0].split(";")[0];
  assert.match(cookies[0], /Secure/);
  assert.match(cookies[0], /HttpOnly/);
  assert(cookies.some((c) => c.startsWith("yep-anywhere-desktop-session=;")));
  assert(cookies.some((c) => c.startsWith("yep-anywhere-acting-user=;")));
  assert.equal(
    (await call("/team-entry", { host: "marker.test", body: { ticket } }))
      .status,
    401,
    "Ticket must be single use",
  );
  assert.equal((await call("/team/api/accounts")).status, 401);
  assert.equal((await call("/")).status, 302);
  assert.equal(
    (await call("/", { session: "yep-anywhere-session=stale" })).status,
    302,
  );
  assert.equal(
    (await call("/team/api/accounts", { session: staff })).status,
    401,
    "Employee cookie must not authorize owner management",
  );
  r = await login("owner", "owner-admin");
  const ownerTicket = new URL((await r.json()).next).hash.slice(1);
  r = await call("/team-entry", { body: { ticket: ownerTicket } });
  const ownerCookie = r.headers.getSetCookie()[0].split(";")[0];
  assert.equal((await call("/", { session: ownerCookie })).status, 200);
  r = await call("/team/api/accounts", { session: ownerCookie });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).accounts[0].username, "marker");
  assert.equal(
    (
      await call("/team/api/accounts/marker/disable", {
        session: staff,
        body: {},
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call("/team/api/accounts/marker/disable", {
        session: ownerCookie,
        body: {},
        origin: false,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/team/api/accounts/marker/disable", {
        session: ownerCookie,
        body: {},
      })
    ).status,
    200,
  );
  assert.deepEqual(patch, { disabled: true });
  assert.equal(
    (
      await call("/team/api/accounts/marker/password", {
        session: ownerCookie,
        body: { password: "short" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/team/api/accounts/marker/password", {
        session: ownerCookie,
        body: { password: "new-test-password" },
      })
    ).status,
    200,
  );
  assert.deepEqual(patch, { password: "new-test-password" });
  assert.equal(
    (
      await call("/team/api/accounts/marker/open", {
        session: ownerCookie,
        body: {},
      })
    ).status,
    200,
  );
  assert.equal((await call("/team", { host: "attacker.test" })).status, 421);
  r = await call("/team/api/login", {
    body: { username: "marker", password: "staff-password" },
    session: ownerCookie,
  });
  assert.equal(r.status, 200);
  assert(
    r.headers
      .getSetCookie()
      .some((c) => c.startsWith("yep-anywhere-session=;")),
  );
  assert.equal(
    (await call("/team/api/accounts", { session: ownerCookie })).status,
    401,
    "Switching to staff must revoke the previous owner login",
  );
});
