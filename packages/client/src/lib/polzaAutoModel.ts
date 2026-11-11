import type {
  ModelInfo,
  ProviderInfo,
  ProviderName,
} from "@yep-anywhere/shared";
import { useCallback, useSyncExternalStore } from "react";

export const POLZA_AUTO_MODEL = "polza:auto";
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

/** Only an explicit failed attempt warrants the stronger route. */
export function autoModelForProvider(
  provider: ProviderName,
  models: ModelInfo[],
  text: string,
): string | undefined {
  const escalate =
    /(?:предыдущ\S*\s+попытк\S*|первая\s+попытка|previous attempt).{0,80}(?:не\s+(?:прош|работ|помог)|fail)|(?:tests?\s+failed|тесты\s+не\s+прошли)/i.test(
      text,
    );
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
          : provider === "codex-oss"
            ? ["openrouter/auto"]
            : [];
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
