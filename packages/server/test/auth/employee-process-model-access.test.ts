import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { createLimitedUsersMiddleware } from "../../src/middleware/limited-users.js";
import type { SessionAccessResolver } from "../../src/auth/sessionAccess.js";
import type { LimitedUserGrants } from "@yep-anywhere/shared";
const boundary = vi.hoisted(() => ({ dedicated: true }));
vi.mock("../../src/auth/dedicatedEmployeeRuntime.js", () => ({
  get DEDICATED_EMPLOYEE_RUNTIME() {
    return boundary.dedicated;
  },
}));
it("scopes model/config access through the actual process session, preserving other operator denials", async () => {
  let level = "join";
  const app = new Hono();
  app.use(
    "/api/*",
    createLimitedUsersMiddleware({
      getProcessSessionId: (id) =>
        ({ mine: "s1", other: "s2" })[id as "mine" | "other"],
      getActiveGrants: () =>
        ({
          lock: {},
          joinProjects: level === "join" ? ["p1"] : [],
          viewProjects: ["p1"],
          newSessionProjects: level === "join" ? ["p1"] : [],
          joinStaleOffsetMinutes: 0,
        }) as LimitedUserGrants,
      getCookieSessionUsername: async () => "marker",
      getSuperuserIdentity: () => null,
      getCookieSecret: () => "synthetic-cookie-secret",
      sessionAccess: {
        resolve: async (id: string) => ({
          projectId: id === "s1" ? "p1" : "p2",
          provider: "claude",
          lastActivityMs: 0,
          createdByUser: "marker",
          sandboxed: true,
        }),
        isFresh: () => false,
      } as unknown as SessionAccessResolver,
    }),
  );
  app.all("/api/processes/:id/:action", (c) => c.json({ ok: true }));
  app.post("/api/projects/:projectId/sessions/:sessionId/resume", (c) =>
    c.json({ sessionId: c.req.param("sessionId") }),
  );
  const post = (path: string) =>
    app.request(path, {
      method: "POST",
      body: '{"model":"x-ai/grok-4.7"}',
      headers: { "content-type": "application/json" },
    });
  expect((await post("/api/processes/mine/model")).status).toBe(200);
  expect((await post("/api/processes/mine/config")).status).toBe(200);
  expect((await post("/api/processes/other/model")).status).toBe(403);
  expect((await post("/api/processes/missing/model")).status).toBe(404);
  expect((await post("/api/processes/mine/abort")).status).toBe(403);
  // An idle dedicated session must resume in place; it is not redirected.
  const sameChat = await post("/api/projects/p1/sessions/s1/resume");
  expect(sameChat.status).toBe(200);
  expect(await sameChat.json()).toEqual({ sessionId: "s1" });
  level = "view";
  expect((await post("/api/projects/p1/sessions/s1/resume")).status).toBe(403);
  expect((await post("/api/processes/mine/model")).status).toBe(403);
  level = "join";
  boundary.dedicated = false;
  expect((await post("/api/processes/mine/model")).status).toBe(403);
  const coldShared = await post("/api/projects/p1/sessions/s1/resume");
  expect(coldShared.status).toBe(403);
  expect(await coldShared.json()).toMatchObject({ reason: "stale-session" });
  boundary.dedicated = true;
});
