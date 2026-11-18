import fs from "node:fs/promises";
import path from "node:path";
import { projectId } from "./config.mjs";

export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

export async function activeActor(config, actor) {
  if (actor === "owner") return true;
  if (actor !== "marker") return false;
  try {
    const settings = JSON.parse(
      await fs.readFile(
        path.join(config.authority, "server-settings.json"),
        "utf8",
      ),
    );
    const users = JSON.parse(
      await fs.readFile(
        path.join(config.authority, "limited-users.json"),
        "utf8",
      ),
    );
    const user = users.users[actor];
    return (
      settings.settings.limitedUsersEnabled === true &&
      user &&
      !user.disabled &&
      user.newSessionProjects?.includes(projectId(config))
    );
  } catch {
    return false;
  }
}

export async function authorize(req, config, store) {
  if (req.url.startsWith("/media/agent/")) {
    const bearer = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(
      req.headers.authorization || "",
    );
    const grant = bearer && store.token(bearer[1]);
    if (!grant || !(await activeActor(config, grant.actor)))
      throw new HttpError(401, "agent_access_denied");
    return { ...grant, agent: true };
  }
  const response = await fetch(`${config.core}/api/users/me`, {
    headers: {
      cookie: req.headers.cookie || "",
      host: req.headers.host || new URL(config.core).host,
      "x-yep-anywhere": "true",
      ...(req.headers.authorization
        ? { authorization: req.headers.authorization }
        : {}),
    },
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new HttpError(401, "login_required");
  const me = await response.json();
  const actor = me.username || (me.superuser && !me.switched ? "owner" : null);
  if (!actor || !(await activeActor(config, actor)))
    throw new HttpError(403, "media_access_denied");
  if (
    actor !== "owner" &&
    !me.grants?.newSessionProjects?.includes(projectId(config))
  ) {
    throw new HttpError(403, "project_access_required");
  }
  return { actor, sites: Object.keys(config.sites), agent: false };
}

export function mutationGuard(req, config) {
  if (req.url.startsWith("/media/agent/")) return;
  if (req.headers["x-yep-anywhere"] !== "true")
    throw new HttpError(403, "required_header");
  const origin = req.headers.origin;
  const expected = config.origin || `https://${req.headers.host}`;
  if (origin && origin !== expected) throw new HttpError(403, "wrong_origin");
  if (req.headers["sec-fetch-site"] === "cross-site")
    throw new HttpError(403, "wrong_origin");
}
