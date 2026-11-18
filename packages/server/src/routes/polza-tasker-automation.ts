import http from "node:http";
import { Hono } from "hono";
import { PRINCIPAL_VARIABLE, type Principal } from "../auth/principal.js";

/** Deployment-specific scheduler; no browser credential or caller-selected account is forwarded. */
export function createTaskerAutomationRoutes() {
  const routes = new Hono<{ Variables: { yaPrincipal: Principal } }>();
  routes.all("/", async (c) => {
    if (!["GET", "POST"].includes(c.req.method))
      return c.json({ error: "Method unavailable" }, 405);
    const principal = c.get(PRINCIPAL_VARIABLE);
    if (!principal) return c.json({ error: "Authentication required" }, 401);
    if (process.env.POLZA_EMPLOYEE_NAME && principal.kind === "superuser")
      return c.json(
        {
          available: false,
          error: "Switch to the employee identity to configure their tasks",
        },
        403,
      );
    const token = process.env.POLZA_TASK_AUTOMATION_TOKEN;
    const socket = process.env.POLZA_TASK_AUTOMATION_SOCKET;
    if (!token || !socket)
      return c.json(
        {
          available: false,
          error: "Task automation is not configured on this server",
        },
        503,
      );
    let input: Record<string, unknown>;
    try {
      input =
        c.req.method === "GET"
          ? { ...c.req.query(), operation: c.req.query("operation") ?? "get" }
          : await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
      return c.json({ error: "Invalid request" }, 400);
    if (
      c.req.method === "GET" &&
      !["get", "context", "result"].includes(String(input.operation))
    )
      return c.json({ error: "Read operation required" }, 405);
    const payload = JSON.stringify({
      ...input,
      principal:
        principal.kind === "limited" ? principal.username : "superuser",
    });
    if (Buffer.byteLength(payload) > 262144)
      return c.json({ error: "Request too large" }, 413);
    try {
      const response = await new Promise<{ status: number; text: string }>(
        (resolve, reject) => {
          const req = http.request(
            {
              socketPath: socket,
              method: "POST",
              path: "/call",
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
              },
            },
            (res) => {
              let size = 0;
              const chunks: Buffer[] = [];
              res.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (size > 3 * 1024 * 1024)
                  req.destroy(Error("Response too large"));
                else chunks.push(chunk);
              });
              res.on("error", reject);
              res.on("end", () =>
                resolve({
                  status: res.statusCode ?? 503,
                  text: Buffer.concat(chunks).toString(),
                }),
              );
            },
          );
          req.setTimeout(60000, () =>
            req.destroy(Error("Automation request timed out")),
          );
          req.on("error", reject);
          req.end(payload);
        },
      );
      return new Response(response.text, {
        status: response.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return c.json(
        {
          available: false,
          error:
            "Automation service unavailable; inspect execution history before retrying",
        },
        503,
      );
    }
  });
  return routes;
}
