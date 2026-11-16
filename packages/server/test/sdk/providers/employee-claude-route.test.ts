import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LimitedUserGrants } from "@yep-anywhere/shared";
import {
  limitExistingSessionLaunch,
  limitNewSessionLaunch,
} from "../../../src/auth/limitedLaunchPolicy.js";
import { ClaudeProvider } from "../../../src/sdk/providers/claude.js";
import { employeeClaudeEnvironment } from "../../../src/sdk/providers/employee-claude-route.js";
import type { ModelSettings } from "../../../src/supervisor/Supervisor.js";

const boundary = vi.hoisted(() => ({ dedicated: false }));
vi.mock("../../../src/auth/dedicatedEmployeeRuntime.js", () => ({
  get DEDICATED_EMPLOYEE_RUNTIME() {
    return boundary.dedicated;
  },
}));
const grants = {
  lock: { provider: "codex", model: "qwen/qwen3-coder" },
} as LimitedUserGrants;
beforeEach(() => {
  boundary.dedicated = true;
  vi.stubEnv("OPENAI_API_KEY", "scoped-synthetic-capability");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("continues native Claude history under the same Qwen lock and broker capability", () => {
  const settings: ModelSettings = { providerName: "claude", model: "haiku" };
  expect(
    limitExistingSessionLaunch(grants, settings, { provider: "claude" }),
  ).toBeNull();
  expect(settings.model).toBe("qwen/qwen3-coder");
  expect(new ClaudeProvider().resolveLaunchModel("haiku")).toBe(
    "qwen/qwen3-coder",
  );
  expect(employeeClaudeEnvironment()).toMatchObject({
    ANTHROPIC_AUTH_TOKEN: "scoped-synthetic-capability",
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:3456",
    ANTHROPIC_MODEL: "qwen/qwen3-coder",
  });
});

it("does not allow changing the model, choosing another provider or starting new Claude sessions", () => {
  expect(
    limitExistingSessionLaunch(
      grants,
      { providerName: "claude" },
      { provider: "claude", model: "opus" },
    ),
  ).toHaveProperty("error");
  expect(
    limitExistingSessionLaunch(grants, { providerName: "claude-gateway" }, {}),
  ).toHaveProperty("error");
  expect(limitNewSessionLaunch(grants, { provider: "claude" })).toHaveProperty(
    "error",
  );
});

it("keeps configured model locks on the scoped native transport", () => {
  expect(
    limitExistingSessionLaunch(
      {
        lock: { provider: "codex", model: "other-model" },
      } as LimitedUserGrants,
      { providerName: "claude" },
      {},
    ),
  ).toBeNull();
  expect(
    limitExistingSessionLaunch(
      grants,
      { providerName: "claude", executor: "other-host" },
      {},
    ),
  ).toHaveProperty("error");
});

it("leaves shared/owner auth and cross-provider refusal unchanged", () => {
  boundary.dedicated = false;
  expect(employeeClaudeEnvironment()).toEqual({});
  expect(new ClaudeProvider().resolveLaunchModel(undefined)).toBeUndefined();
  expect(
    limitExistingSessionLaunch(
      grants,
      {
        providerName: "claude",
        sandboxLevel: "project-write",
        sandboxNetworkFirewall: true,
      },
      {},
    ),
  ).toHaveProperty("error");
});

it("fails closed when the employee capability is missing", () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  expect(employeeClaudeEnvironment).toThrow(
    "Employee model capability is unavailable",
  );
});

it("normalizes a stale Ollama hint without relaxing the model lock", () => {
  const settings: ModelSettings = { providerName: "claude-ollama" };
  expect(
    limitExistingSessionLaunch(grants, settings, { provider: "claude-ollama" }),
  ).toBeNull();
  expect(settings.providerName).toBe("claude");
  expect(settings.model).toBe("qwen/qwen3-coder");
  expect(
    limitExistingSessionLaunch(
      grants,
      { providerName: "claude-ollama" },
      { provider: "claude-ollama", model: "expensive-model" },
    ),
  ).toHaveProperty("error");
});

it("advertises the broker catalog without an employee Claude OAuth login", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "qwen/qwen3-coder" }, { id: "x-ai/grok-4.7" }],
          }),
        ),
    ),
  );
  const provider = new ClaudeProvider();
  expect((await provider.getAvailableModels()).map((m) => m.id)).toEqual([
    "qwen/qwen3-coder",
    "x-ai/grok-4.7",
  ]);
  expect(await provider.getLoginLaunch()).toBeNull();
});
