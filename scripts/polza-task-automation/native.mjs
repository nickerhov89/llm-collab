import http from "node:http";
export class NativeClient {
  constructor(realm) {
    this.realm = realm;
    this.cookie = null;
    this.expires = 0;
  }
  async raw(method, path, data, cookie = this.cookie) {
    const realm = this.realm;
    const payload = data === undefined ? null : JSON.stringify(data);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: realm.port,
          method,
          path: `/api${path}`,
          headers: {
            host: realm.host,
            origin: `https://${realm.host}`,
            "x-yep-anywhere": "true",
            "content-type": "application/json",
            ...(cookie ? { cookie } : {}),
          },
        },
        (res) => {
          let size = 0;
          const chunks = [];
          res.on("data", (chunk) => {
            size += chunk.length;
            if (size > 6 * 1024 * 1024)
              req.destroy(Error("Native response too large"));
            else chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => {
            try {
              resolve({
                status: res.statusCode,
                cookies: res.headers["set-cookie"] ?? [],
                body: JSON.parse(Buffer.concat(chunks).toString() || "{}"),
              });
            } catch {
              reject(Error("Invalid native response"));
            }
          });
        },
      );
      req.setTimeout(15000, () =>
        req.destroy(Error("Native request timed out; do not replay writes")),
      );
      req.on("error", reject);
      req.end(payload);
    });
  }
  async ready(retried = false) {
    if (!this.cookie || Date.now() > this.expires) {
      const auth = await this.raw(
        "POST",
        "/auth/login",
        { password: this.realm.adminPassword },
        null,
      );
      const session = auth.cookies.find((x) =>
        x.startsWith("yep-anywhere-session="),
      );
      if (auth.status !== 200 || !session)
        throw Error("Account sign-in unavailable");
      this.cookie = session.split(";")[0];
      if (this.realm.username) {
        const switched = await this.raw("POST", "/users/switch", {
          username: this.realm.username,
        });
        if (switched.status !== 200) {
          await this.close();
          throw Error("Account disabled or unavailable");
        }
        const acting = switched.cookies.find((x) =>
          x.startsWith("yep-anywhere-acting-user="),
        );
        if (!acting) {
          await this.close();
          throw Error("Missing limited identity");
        }
        this.cookie += `; ${acting.split(";")[0]}`;
      }
      this.expires = Date.now() + 240000;
    }
    const who = await this.raw("GET", "/users/me");
    if (who.status === 401 && !retried) {
      await this.close();
      return this.ready(true);
    }
    if (
      who.status !== 200 ||
      (this.realm.username
        ? who.body.username !== this.realm.username
        : !who.body.superuser)
    ) {
      await this.close();
      throw Error("Account disabled or unavailable");
    }
  }
  async call(method, path, data) {
    const r = await this.raw(method, path, data);
    if (r.status < 200 || r.status >= 300) {
      const error = Error(`Native request refused (${r.status})`);
      error.definiteRejected =
        r.status >= 400 && r.status < 500 && r.status !== 408;
      throw error;
    }
    return r.body;
  }
  async close() {
    if (this.cookie) await this.raw("POST", "/auth/logout", {}).catch(() => {});
    this.cookie = null;
    this.expires = 0;
  }
}
