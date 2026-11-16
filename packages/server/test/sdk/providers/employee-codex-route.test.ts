import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { employeeCodexRouteArguments } from "../../../src/sdk/providers/employee-codex-route.js";

const boundary = vi.hoisted(() => ({ dedicated: false }));
vi.mock("../../../src/auth/dedicatedEmployeeRuntime.js", () => ({
  get DEDICATED_EMPLOYEE_RUNTIME() {
    return boundary.dedicated;
  },
}));
const id = "11111111-1111-7111-8111-111111111111";
let directory: string;
let file: string;
beforeEach(async () => {
  boundary.dedicated = true;
  directory = await mkdtemp(join(tmpdir(), "employee-route-"));
  file = join(directory, `rollout-2026-11-16T00-00-00-${id}.jsonl`);
  vi.stubEnv("CODEX_SESSIONS_DIR", directory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
async function history(provider: string | undefined, sessionId = id) {
  const bytes = `${JSON.stringify({
    timestamp: "2026-11-16T00:00:00.000Z",
    type: "session_meta",
    payload: {
      id: sessionId,
      timestamp: "2026-11-16T00:00:00.000Z",
      cwd: "/private/project",
      originator: "codex_cli_rs",
      cli_version: "0.167.0",
      model_provider: provider,
    },
  })}\n`;
  await writeFile(file, bytes);
  return bytes;
}

it.each(["openai", "polza_employee", "old-gateway", undefined])(
  "keeps native %s identity but pins its process route to the scoped broker",
  async (provider) => {
    const original = await history(provider);
    const args = await employeeCodexRouteArguments(id);
    const name = provider ?? "openai";
    expect(args).toContain(`model_provider="${name}"`);
    expect(args).toContain(
      `model_providers.${name}.base_url="http://127.0.0.1:3456/v1"`,
    );
    expect(args).toContain(`model_providers.${name}.env_key="OPENAI_API_KEY"`);
    expect(args).toContain(
      `model_providers.${name}.requires_openai_auth=false`,
    );
    expect(await readFile(file, "utf8")).toBe(original);
    expect(args).toContain(`model_providers.${name}.supports_websockets=false`);
    expect(args).toContain(`model_providers.${name}.request_max_retries=0`);
    expect(args).toContain(`model_providers.${name}.stream_max_retries=0`);
  },
);

it("leaves owner/shared launches untouched, without reading their history", async () => {
  boundary.dedicated = false;
  expect(await employeeCodexRouteArguments(id)).toEqual([]);
});

it("routes fresh employee sessions through their provisioned alias", async () => {
  expect(await employeeCodexRouteArguments()).toContain(
    'model_provider="polza_employee"',
  );
});

it.each(["bad.key", 'bad"=true', ""])(
  "refuses unsafe provider alias %s before spawning Codex",
  async (provider) => {
    await history(provider);
    await expect(employeeCodexRouteArguments(id)).rejects.toThrow(
      "Invalid employee Codex resume provider identity",
    );
  },
);

it("refuses missing history instead of silently starting another chat", async () => {
  await expect(employeeCodexRouteArguments(id)).rejects.toThrow(
    "Cannot locate employee Codex resume history",
  );
});

it("refuses a transcript whose metadata belongs to another session", async () => {
  await history("openai", "22222222-2222-7222-8222-222222222222");
  await expect(employeeCodexRouteArguments(id)).rejects.toThrow();
});
