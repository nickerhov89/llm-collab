import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
const config = JSON.parse(await readFile(process.env.TEAM_CONFIG, "utf8"));
const page = await readFile(new URL("./team.html", import.meta.url));
const owner = config.realms.owner;
const realms = new Map(Object.entries(config.realms));
const byHost = new Map(
  [...realms].map(([name, r]) => [r.host, { name, ...r }]),
);
const tickets = new Map(),
  attempts = new Map(),
  adminSessions = new Map();
const token = () => randomBytes(32).toString("hex");
const cookie = (header, name) => {
  const parts = (header ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith(name + "="));
  return parts.length === 1 ? parts[0] : "";
};
function reply(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}
function csrf(req, host) {
  return (
    req.headers.origin === `https://${host}` &&
    req.headers["content-type"]?.split(";")[0] === "application/json"
  );
}
async function body(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 4096) throw Error("Body too large");
  }
  return JSON.parse(data);
}
async function api(r, path, { session, method = "GET", data } = {}) {
  return new Promise((resolve, reject) => {
    const payload = data === undefined ? undefined : JSON.stringify(data);
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: r.port,
        path: "/api" + path,
        method,
        headers: {
          host: r.host,
          origin: `https://${r.host}`,
          "x-forwarded-proto": "https",
          "x-yep-anywhere": "true",
          "content-type": "application/json",
          ...(session ? { cookie: session } : {}),
        },
      },
      (response) => {
        let text = "";
        response.on("data", (chunk) => {
          text += chunk;
          if (text.length > 5000000)
            request.destroy(Error("Response too large"));
        });
        response.on("error", reject);
        response.on("end", () => {
          clearTimeout(timer);
          let result = {};
          try {
            result = JSON.parse(text);
          } catch {}
          resolve({
            status: response.statusCode,
            body: result,
            cookies: response.headers["set-cookie"] ?? [],
          });
        });
      },
    );
    const timer = setTimeout(
      () => request.destroy(Error("Backend timeout")),
      15000,
    );
    request.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end(payload);
  });
}
async function login(r, username, password) {
  const auth = await api(r, "/auth/login", {
    method: "POST",
    data: username ? { username, password } : { password },
  });
  const session = auth.cookies.find((c) =>
    c.startsWith("yep-anywhere-session="),
  );
  if (auth.status !== 200 || !session) return null;
  const who = await api(r, "/users/me", { session: session.split(";")[0] });
  if (
    who.status !== 200 ||
    who.body.username !== (username || null) ||
    who.body.switched
  )
    return null;
  return session;
}
function handoff(r, session) {
  for (const [id, t] of tickets) if (t.expires < Date.now()) tickets.delete(id);
  if (tickets.size >= 200) throw Error("Too many pending logins");
  const id = token();
  tickets.set(id, { host: r.host, session, expires: Date.now() + 45000 });
  return `https://${r.host}/team-entry#${id}`;
}
async function requireOwner(req) {
  const session = cookie(req.headers.cookie, "yep-anywhere-session");
  if (!session) return false;
  const check = await api(owner, "/users/me", { session });
  return (
    check.status === 200 &&
    check.body.username === null &&
    check.body.superuser === true
  );
}
async function admin(r, name) {
  let cached = adminSessions.get(name);
  if (!cached || cached.expires < Date.now()) {
    const session = await login(r, "", r.adminPassword);
    if (!session) throw Error("Account administration unavailable");
    cached = { session: session.split(";")[0], expires: Date.now() + 300000 };
    adminSessions.set(name, cached);
  }
  return cached.session;
}
function ownerRoot(req, res) {
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: owner.frontPort ?? owner.port,
      path: "/",
      headers: {
        host: owner.host,
        origin: `https://${owner.host}`,
        "x-forwarded-proto": "https",
        cookie: cookie(req.headers.cookie, "yep-anywhere-session"),
      },
    },
    (response) => {
      res.writeHead(response.statusCode, {
        "content-type":
          response.headers["content-type"] ?? "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.on("error", () => res.destroy());
      response.pipe(res);
    },
  );
  upstream.setTimeout(15000, () => upstream.destroy(Error("Frontend timeout")));
  upstream.on("error", () => {
    if (!res.headersSent)
      reply(res, 502, { error: "Cowork временно недоступен" });
    else res.destroy();
  });
  res.on("close", () => upstream.destroy());
  upstream.end();
}
const server = http.createServer(async (req, res) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  const host = req.headers.host;
  const realm = byHost.get(host);
  if (!realm) return reply(res, 421, { error: "Unknown host" });
  const path = req.url;
  try {
    if (
      host === owner.host &&
      req.method === "GET" &&
      new URL(path, "http://localhost").pathname === "/"
    ) {
      if (!(await requireOwner(req))) {
        res.writeHead(302, { location: "/team" });
        return res.end();
      }
      ownerRoot(req, res);
      return;
    }
    if (req.method === "GET" && path === "/team-entry") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      });
      return res.end(
        `<!doctype html><meta charset="utf-8"><title>Cowork — вход</title><p id="s">Открываем кабинет…</p><script>const ticket=location.hash.slice(1);history.replaceState(null,'','/team-entry');fetch('/team-entry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})}).then(async r=>{if(!r.ok)throw Error();location.replace('/')}).catch(()=>{document.getElementById('s').textContent='Ссылка входа истекла. Вернитесь на общую страницу Cowork и войдите заново.'})</script>`,
      );
    }
    if (req.method === "POST" && path === "/team-entry") {
      if (!csrf(req, host))
        return reply(res, 403, { error: "Origin required" });
      const { ticket } = await body(req);
      const stored = tickets.get(ticket);
      if (!stored || stored.expires < Date.now() || stored.host !== host)
        return reply(res, 401, { error: "Login expired" });
      tickets.delete(ticket);
      // A staff login cannot inherit an administrator desktop/acting identity.
      res.setHeader("Set-Cookie", [
        stored.session,
        "yep-anywhere-desktop-session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax",
        "yep-anywhere-acting-user=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax",
      ]);
      return reply(res, 200, { success: true });
    }
    if (host !== owner.host) return reply(res, 404, { error: "Not found" });
    if (req.method === "GET" && (path === "/team" || path === "/team/")) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      });
      return res.end(page);
    }
    if (req.method === "POST" && path === "/team/api/login") {
      if (!csrf(req, host))
        return reply(res, 403, { error: "Origin required" });
      const ip = req.headers["x-real-ip"] ?? req.socket.remoteAddress;
      const now = Date.now();
      for (const [key, value] of attempts)
        if (value.until < now) attempts.delete(key);
      if (attempts.size > 10000)
        return reply(res, 429, { error: "Вход временно недоступен" });
      const rate = attempts.get(ip) ?? { count: 0, until: now + 300000 };
      attempts.set(ip, rate);
      if (++rate.count > 30)
        return reply(res, 429, {
          error: "Слишком много попыток. Подождите 5 минут.",
        });
      const data = await body(req);
      const name =
        typeof data.username === "string"
          ? data.username.trim().toLowerCase()
          : "";
      const key = ["", "admin", "owner"].includes(name) ? "owner" : name;
      const target = realms.get(key);
      if (
        !target ||
        typeof data.password !== "string" ||
        !data.password ||
        data.password.length > 200
      )
        return reply(res, 401, { error: "Неверный логин или пароль" });
      const session = await login(
        target,
        key === "owner" ? "" : key,
        data.password,
      );
      if (!session)
        return reply(res, 401, { error: "Неверный логин или пароль" });
      if (key !== "owner") {
        const previous = cookie(req.headers.cookie, "yep-anywhere-session");
        if (previous)
          await api(owner, "/auth/logout", {
            session: previous,
            method: "POST",
            data: {},
          });
        res.setHeader(
          "Set-Cookie",
          [
            "yep-anywhere-session",
            "yep-anywhere-desktop-session",
            "yep-anywhere-acting-user",
          ].map(
            (name) =>
              name + "=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax",
          ),
        );
      }
      return reply(res, 200, { next: handoff(target, session) });
    }
    if (!path.startsWith("/team/api/"))
      return reply(res, 404, { error: "Not found" });
    if (req.method !== "GET" && !csrf(req, host))
      return reply(res, 403, { error: "Origin required" });
    if (!(await requireOwner(req)))
      return reply(res, 401, { error: "Войдите как владелец" });
    if (req.method === "GET" && path === "/team/api/accounts") {
      const accounts = await Promise.all(
        [...realms]
          .filter(([n]) => n !== "owner")
          .map(async ([name, r]) => {
            try {
              const session = await admin(r, name);
              const result = await api(r, "/users", { session });
              if (result.status !== 200) throw Error();
              const user = result.body.users.find((u) => u.username === name);
              if (!user) throw Error();
              return {
                username: name,
                label: r.label,
                url: `https://${r.host}`,
                online: true,
                disabled: user.disabled === true,
                projects: user.newSessionProjects?.length ?? 0,
              };
            } catch {
              return { username: name, label: r.label, online: false };
            }
          }),
      );
      return reply(res, 200, { accounts });
    }
    const match =
      /^\/team\/api\/accounts\/(ceo|cfo|cto|marker)\/(disable|enable|password|open)$/.exec(
        path,
      );
    if (req.method === "POST" && match) {
      const [, name, action] = match,
        r = realms.get(name);
      if (!r) return reply(res, 404, { error: "Unknown account" });
      if (action === "open") {
        const session = await login(r, "", r.adminPassword);
        if (!session) throw Error();
        return reply(res, 200, { next: handoff(r, session) });
      }
      const data = await body(req);
      let patch;
      if (action === "password") {
        if (
          typeof data.password !== "string" ||
          data.password.length < 12 ||
          data.password.length > 200
        )
          return reply(res, 400, { error: "Пароль: от 12 до 200 символов" });
        patch = { password: data.password };
      } else patch = { disabled: action === "disable" };
      const result = await api(r, "/users/" + name, {
        session: await admin(r, name),
        method: "PATCH",
        data: patch,
      });
      if (result.status !== 200)
        return reply(res, 502, { error: "Не удалось обновить учётку" });
      return reply(res, 200, { success: true });
    }
    return reply(res, 404, { error: "Not found" });
  } catch {
    if (!res.headersSent)
      reply(res, 502, { error: "Сервис временно недоступен. Повторите вход." });
    else res.destroy();
  }
});
server.headersTimeout = 10000;
server.requestTimeout = 20000;
server.maxConnections = 100;
server.listen(Number(process.env.PORT ?? 3460), "127.0.0.1", () =>
  process.send?.({ port: server.address().port }),
);
