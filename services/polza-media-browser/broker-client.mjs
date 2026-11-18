import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const operations = {
  media_status: "status",
  media_open: "open",
  media_snapshot: "snapshot",
  media_login: "login",
  media_close: "close",
  media_submit_job: "job",
  media_job_status: "job-status",
  media_resume: "resume",
};

export async function mediaBrokerCall(name, args, execute = run) {
  const operation = operations[name];
  if (!operation) throw new Error("unknown_media_tool");
  const payload =
    name === "media_submit_job"
      ? args
      : ["open", "snapshot", "login", "close"].includes(operation)
        ? {
            site: args.site,
            ...(operation === "open" && args.url ? { url: args.url } : {}),
          }
        : ["job-status", "resume"].includes(operation)
          ? { id: args.id }
          : {};
  let stdout;
  try {
    ({ stdout } = await execute(
      "/usr/local/bin/polza-integration",
      ["media." + operation, JSON.stringify(payload)],
      { timeout: 50_000, maxBuffer: 8 * 1024 * 1024 },
    ));
  } catch (error) {
    if (typeof error.stdout !== "string" || !error.stdout)
      throw new Error("media_broker_unavailable");
    stdout = error.stdout;
  }
  const response = JSON.parse(stdout);
  if (!response.ok) {
    // Never retry a UID/grant denial using the legacy bearer or another role.
    throw new Error(response.error || "media_access_denied");
  }
  return response.result;
}

/** Bridge the installed legacy worker's exact media routes, without credentials. */
export function legacyMediaRequest(path, body = {}) {
  if (path === "/media/agent/status") return ["media_status", {}];
  const site =
    /^\/media\/agent\/sites\/([a-z]+)\/(open|snapshot|login|close)$/.exec(path);
  if (site) return ["media_" + site[2], { ...body, site: site[1] }];
  if (path === "/media/agent/jobs") return ["media_submit_job", body];
  const job = /^\/media\/agent\/jobs\/([A-Za-z0-9_-]+)(\/resume)?$/.exec(path);
  if (job)
    return [job[2] ? "media_resume" : "media_job_status", { id: job[1] }];
  throw new Error("unknown_media_route");
}
