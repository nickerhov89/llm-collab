import { mkdtemp, rm, readdir, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PRINCIPAL_VARIABLE } from "../../src/auth/principal.js";
import { createPolzaTaskerRoutes } from "../../src/routes/polza-tasker.js";
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tasker-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
function app() {
  const a = new Hono();
  a.use("*", async (c, next) => {
    const user = c.req.header("test-user");
    if (user)
      c.set(
        PRINCIPAL_VARIABLE,
        user === "owner"
          ? { kind: "superuser" }
          : { kind: "limited", username: user },
      );
    await next();
  });
  a.route("/api/tasker", createPolzaTaskerRoutes(dir));
  return a;
}
const data = {
  version: 1,
  tasks: [{ id: "one", title: "Private task", done: false }],
};
function put(
  a: Hono,
  user: string,
  revision = 0,
  accountKey = user === "owner" ? "owner" : `user:${user}`,
) {
  return a.request("/api/tasker", {
    method: "PUT",
    headers: { "test-user": user, "Content-Type": "application/json" },
    body: JSON.stringify({ revision, accountKey, data }),
  });
}
it("persists private account data across route recreation and separates principals", async () => {
  const a = app();
  expect((await a.request("/api/tasker")).status).toBe(401);
  expect((await put(a, "alice")).status).toBe(200);
  const b = app();
  const saved = await (
    await b.request("/api/tasker", { headers: { "test-user": "alice" } })
  ).json();
  expect(saved).toEqual({ revision: 1, accountKey: "user:alice", data });
  for (const user of ["bob", "owner"]) {
    expect(
      await (
        await b.request("/api/tasker", { headers: { "test-user": user } })
      ).json(),
    ).toMatchObject({ revision: 0, data: { tasks: [] } });
  }
  expect((await put(b, "bob", 0, "user:alice")).status).toBe(409);
  const files = await readdir(join(dir, "polza-tasker"));
  expect(files).toHaveLength(1);
  expect((await stat(join(dir, "polza-tasker", files[0]!))).mode & 0o777).toBe(
    0o600,
  );
});
it("serializes competing writes and rejects stale revisions", async () => {
  const a = app();
  const responses = await Promise.all([put(a, "alice"), put(a, "alice")]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await put(a, "alice", 1)).status).toBe(200);
});
it("keeps corrupt storage intact instead of replacing it", async () => {
  const a = app();
  await put(a, "alice");
  const file = (await readdir(join(dir, "polza-tasker")))[0]!;
  await writeFile(join(dir, "polza-tasker", file), "broken");
  expect(
    (await a.request("/api/tasker", { headers: { "test-user": "alice" } }))
      .status,
  ).toBe(503);
  expect((await put(a, "alice", 1)).status).toBe(503);
});
it("rejects invalid data without creating storage", async () => {
  const a = app();
  const response = await a.request("/api/tasker", {
    method: "PUT",
    headers: { "test-user": "owner", "Content-Type": "application/json" },
    body: JSON.stringify({
      revision: 0,
      accountKey: "owner",
      data: { version: 1, tasks: [{ id: "x", title: "" }] },
    }),
  });
  expect(response.status).toBe(400);
  expect(
    (
      await a.request("/api/tasker", { headers: { "test-user": "owner" } })
    ).headers.get("Cache-Control"),
  ).toBe("no-store");
});
