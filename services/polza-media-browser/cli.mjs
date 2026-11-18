#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const actorIndex = args.indexOf("--actor");
const actor = actorIndex >= 0 ? args.splice(actorIndex, 2)[1] : "marker";
if (!["owner", "marker"].includes(actor))
  throw new Error("Expected --actor marker or --actor owner");
const configFile =
  process.env.POLZA_MEDIA_CONFIG ||
  path.join(
    os.homedir(),
    ".local/state/polza-media-browser/agents",
    `${actor}.json`,
  );
if (!args.length || args[0] === "help") {
  console.info(
    "polza-media [--actor marker|owner] status | open SITE | snapshot SITE | job FILE.json | job-status ID | cancel ID\nJob: {site,intent:draft|submit_review|publish,title,idempotencyKey,steps:[{type:goto,url},{type:fill,selector,value},{type:upload,selector,path},{type:click,selector},{type:expect,text}]}\nUse snapshot selectors; no JavaScript/evaluate or agent password entry. Uploads must be inside the SEO project. Last step must assert visible result text. Interrupted publication jobs are never automatically replayed.",
  );
  process.exit(0);
}
let config;
try {
  config = JSON.parse(await fs.readFile(configFile, "utf8"));
} catch {
  console.error(
    "Connect this actor in Cowork → /media → Подключить агента. No active CLI configuration.",
  );
  process.exit(1);
}
const [command, parameter] = args;
let route;
let body;
switch (command) {
  case "status":
    route = "/status";
    break;
  case "open":
    route = `/sites/${encodeURIComponent(parameter)}/open`;
    body = {};
    break;
  case "login":
  case "close":
    route = `/sites/${encodeURIComponent(parameter)}/${command}`;
    body = {};
    break;
  case "snapshot":
    route = `/sites/${encodeURIComponent(parameter)}/snapshot`;
    break;
  case "job":
    route = "/jobs";
    body = JSON.parse(await fs.readFile(parameter, "utf8"));
    break;
  case "job-status":
    route = `/jobs/${encodeURIComponent(parameter)}`;
    break;
  case "cancel":
    route = `/jobs/${encodeURIComponent(parameter)}/cancel`;
    body = {};
    break;
  case "resume":
    route = `/jobs/${encodeURIComponent(parameter)}/resume`;
    body = {};
    break;
  default:
    throw new Error("Unknown command; run polza-media help");
}
try {
  const response = await fetch(`${config.origin}/media/agent${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(45_000),
  });
  const result = await response.json();
  console.info(JSON.stringify(result, null, 2));
  if (!response.ok) process.exitCode = 1;
} catch {
  console.error(
    "Media service is unreachable. Check the Cowork URL and service status; no request was replayed.",
  );
  process.exitCode = 1;
}
