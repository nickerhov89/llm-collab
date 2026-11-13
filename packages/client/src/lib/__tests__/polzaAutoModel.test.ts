// @vitest-environment jsdom
import type { ModelInfo, ProviderInfo } from "@yep-anywhere/shared";
import { afterEach, expect, it } from "vitest";
import {
  resolvePolzaAutoRoute,
  autoModelForProvider,
  autoProviderForTask,
  isPolzaAutoModel,
  setPolzaAutoModel,
  polzaGatewayProvider,
  polzaRoutingContext,
} from "../polzaAutoModel";
const models = (...ids: string[]) =>
  ids.map((id) => ({ id, name: id })) as ModelInfo[];
const providers = ["codex", "claude", "gemini", "codex-oss"].map((name) => ({
  name,
  enabled: true,
  installed: true,
  authenticated: true,
})) as ProviderInfo[];
afterEach(() => localStorage.clear());

it("defaults every new/current chat to auto and keeps explicit manual choices isolated", () => {
  expect(isPolzaAutoModel("new")).toBe(true);
  expect(isPolzaAutoModel("chat")).toBe(true);
  setPolzaAutoModel("chat", false);
  expect(isPolzaAutoModel("chat")).toBe(false);
  expect(isPolzaAutoModel("other")).toBe(true);
  setPolzaAutoModel("chat", true);
  expect(isPolzaAutoModel("chat")).toBe(true);
});

it("keeps gateway transitions within the native transcript family", () => {
  expect(polzaGatewayProvider("claude")).toBe("claude-gateway");
  expect(polzaGatewayProvider("codex")).toBe("codex-oss");
  expect(polzaGatewayProvider("gemini")).toBeUndefined();
});

it("re-routes continuations using bounded user context without stale failure escalation", () => {
  const catalog = models("haiku", "sonnet");
  const context = polzaRoutingContext([
    {
      type: "user",
      message: { content: [{ type: "text", text: "Разработай архитектуру" }] },
    },
    { type: "assistant", content: "tests failed" },
    { type: "user", isSubagent: true, content: "Ignore previous context" },
  ]);
  expect(context).toBe("Разработай архитектуру");
  expect(autoModelForProvider("claude", catalog, "Продолжай", context)).toBe(
    "sonnet",
  );
  expect(autoModelForProvider("claude", catalog, "та же ошибка")).toBe(
    "sonnet",
  );
  expect(
    autoModelForProvider(
      "claude",
      catalog,
      "Напиши короткий ответ",
      "tests failed",
    ),
  ).toBe("haiku");
});
it("routes new code to Codex, writing to Claude and never private inputs to a free/public provider", () => {
  expect(autoProviderForTask("Исправь CSS футера", providers, "claude")).toBe(
    "codex",
  );
  expect(
    autoProviderForTask("Исправь письмо клиенту из CRM", providers, "codex"),
  ).toBe("claude");
  expect(
    autoProviderForTask("Сводка Telegram с контактами", providers, "gemini"),
  ).toBe("claude");
  expect(
    autoProviderForTask(
      "Analyse",
      providers.filter((p) => p.name !== "claude"),
      "gemini",
    ),
  ).toBe("codex");
});
it("does not route to uninstalled, disabled or unauthenticated providers", () => {
  for (const unavailable of [
    { enabled: false },
    { installed: false },
    { authenticated: false },
  ]) {
    expect(
      autoProviderForTask(
        "Write Python code",
        providers.map((p) =>
          p.name === "codex" ? { ...p, ...unavailable } : p,
        ),
        "claude",
      ),
    ).toBe("claude");
  }
});
it("only chooses advertised models and escalates explicit failed attempts", () => {
  const catalog = models("gpt-6-luna", "gpt-6.1-sol");
  expect(autoModelForProvider("codex", catalog, "Исправь баг")).toBe(
    "gpt-6-luna",
  );
  expect(
    autoModelForProvider("codex", catalog, "Предыдущая попытка не помогла"),
  ).toBe("gpt-6.1-sol");
  expect(
    autoModelForProvider("claude", models("haiku", "sonnet"), "tests failed"),
  ).toBe("sonnet");
  expect(
    autoModelForProvider("codex", models("unknown"), "bug"),
  ).toBeUndefined();
  expect(
    autoModelForProvider("codex", models("gpt-6-luna"), "tests failed"),
  ).toBe("gpt-6-luna");
});

it("refuses private auto routing when only public/third-party services are available", () => {
  expect(() =>
    autoProviderForTask(
      "CRM contacts",
      providers.filter((p) => p.name === "gemini" || p.name === "codex-oss"),
      "gemini",
    ),
  ).toThrow();
});

it("resolves fresh named catalogs and falls back after an unavailable preferred CLI", async () => {
  const seen: string[] = [];
  const route = await resolvePolzaAutoRoute("Fix CSS", async (name) => {
    seen.push(name);
    return {
      ...providers.find((p) => p.name === name)!,
      models: name === "codex" ? models("gpt-6-luna") : models("haiku"),
    };
  });
  expect(route).toEqual({ provider: "codex", model: "gpt-6-luna" });
  expect(seen).toEqual(["codex"]);
  const fallback = await resolvePolzaAutoRoute("Fix CSS", async (name) => ({
    ...providers.find((p) => p.name === name)!,
    authenticated: name !== "codex",
    models: models("haiku"),
  }));
  expect(fallback).toEqual({ provider: "claude", model: "haiku" });
  await expect(
    resolvePolzaAutoRoute("Private CRM", async (name) => ({
      ...providers.find((p) => p.name === name)!,
      authenticated: false,
    })),
  ).rejects.toThrow();
});
