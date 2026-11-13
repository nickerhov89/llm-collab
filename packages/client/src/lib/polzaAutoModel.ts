import type {
  ModelInfo,
  ProviderInfo,
  ProviderName,
} from "@yep-anywhere/shared";
import type { Message } from "../types";
import { useCallback, useSyncExternalStore } from "react";

export const POLZA_AUTO_MODEL = "polza:auto";

/** The gateway must resume the same native transcript format. */
export function polzaGatewayProvider(
  provider?: ProviderName,
): ProviderName | undefined {
  if (provider === "claude" || provider === "claude-gateway")
    return "claude-gateway";
  if (provider === "codex" || provider === "codex-oss") return "codex-oss";
  return undefined;
}

export function polzaRoutingContext(messages: Message[]): string {
  return messages
    .filter((m) => !m.isSubagent && (m.type === "user" || m.role === "user"))
    .slice(-6)
    .map((m) => {
      const content = m.message?.content ?? m.content;
      return typeof content === "string"
        ? content
        : (content ?? [])
            .filter((block) => block.type === "text")
            .map((block) => ("text" in block ? block.text : ""))
            .join("\n");
    })
    .join("\n")
    .slice(-12000);
}
const listeners = new Set<() => void>();
const key = (scope: string) => `polza-model-routing:${scope}`;
export function isPolzaAutoModel(scope: string): boolean {
  return localStorage.getItem(key(scope)) !== "manual";
}
export function setPolzaAutoModel(scope: string, enabled: boolean): void {
  localStorage.setItem(key(scope), enabled ? "auto" : "manual");
  for (const listener of listeners) listener();
}
export function usePolzaAutoModel(scope: string) {
  const enabled = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      window.addEventListener("storage", listener);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", listener);
      };
    },
    () => isPolzaAutoModel(scope),
    () => true,
  );
  return [
    enabled,
    useCallback((value: boolean) => setPolzaAutoModel(scope, value), [scope]),
  ] as const;
}

export function isCodeTask(text: string): boolean {
  return /\b(code|coding|typescript|javascript|python|react|css|html|bug|deploy|test|repository|git|api|sql|website|frontend|backend|debug|build|ui|ux)\b|код|программ|репозитор|деплой|сборк|футер|интерфейс|микрофон|верст|вёрст|баг|кнопк|мобил|сайт|приложени/i.test(
    text,
  );
}

/** Re-evaluate each continuation while retaining the configured cheap-first policy. */
export function autoModelForProvider(
  provider: ProviderName,
  models: ModelInfo[],
  text: string,
  context = "",
): string | undefined {
  const failedAttempt =
    /(?:предыдущ\S*\s+попытк\S*|первая\s+попытка|previous attempt).{0,80}(?:не\s+(?:прош|работ|помог)|fail)|(?:tests?\s+failed|тесты\s+не\s+прошли)|всё?\s+ещ[её].{0,30}не\s+работ|та\s+же\s+(?:ошибка|проблема|хуйня)/i.test(
      text,
    );
  const continuation =
    /^\s*(?:продолж|дальше|давай\s+дальше|continue|go\s+on)/i.test(text);
  const escalate =
    failedAttempt ||
    (continuation &&
      /предыдущ\S*\s+попытк\S*.{0,80}не\s+(?:прош|работ|помог)|tests?\s+failed|та\s+же\s+(?:ошибка|проблема|хуйня)/i.test(
        context.slice(-1200),
      ));
  const order =
    provider === "codex"
      ? escalate
        ? ["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna"]
        : ["gpt-6-luna", "gpt-6.1-sol"]
      : provider === "claude"
        ? escalate
          ? ["sonnet", "haiku"]
          : ["haiku", "sonnet"]
        : provider === "gemini"
          ? ["auto", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]
          : provider === "codex-oss" || provider === "claude-gateway"
            ? ["openrouter/auto"]
            : [];
  if (provider === "codex-oss" || provider === "claude-gateway") {
    return models.find(
      (m) => m.id === "openrouter/auto" || m.id.endsWith("::openrouter/auto"),
    )?.id;
  }
  return order.find((id) => models.some((model) => model.id === id));
}

/** New chats may choose a CLI. Existing chats only change model within theirs.
 * Free/public services never receive private chat context through this policy. */
export function autoProviderForTask(
  text: string,
  providers: ProviderInfo[],
  _fallback: ProviderName,
): ProviderName {
  const preferred: ProviderName[] = isCodeTask(text)
    ? ["codex", "claude"]
    : ["claude", "codex"];
  const selected = preferred.find((name) =>
    providers.some(
      (p) => p.name === name && p.enabled && p.installed && p.authenticated,
    ),
  );
  if (!selected)
    throw new Error(
      "Авто: Claude и Codex недоступны. Выберите сервис вручную.",
    );
  return selected;
}

/** Fetch named catalogs rather than treating lightweight startup descriptors as auth state. */
export async function resolvePolzaAutoRoute(
  text: string,
  fetchProvider: (name: ProviderName) => Promise<ProviderInfo>,
): Promise<{ provider: ProviderName; model: string }> {
  const order: ProviderName[] = isCodeTask(text)
    ? ["codex", "claude"]
    : ["claude", "codex"];
  for (const name of order) {
    let info: ProviderInfo;
    try {
      info = await fetchProvider(name);
    } catch {
      continue;
    }
    if (
      info.name !== name ||
      !info.installed ||
      !info.enabled ||
      !info.authenticated
    )
      continue;
    const model = autoModelForProvider(name, info.models ?? [], text);
    if (model) return { provider: name, model };
  }
  throw new Error(
    "Авто: подходящая модель недоступна. Выберите модель вручную.",
  );
}
