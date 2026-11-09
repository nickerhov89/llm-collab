import type {
  ProviderName,
  ProviderSubscriptionUsage,
} from "@yep-anywhere/shared";
import { useState } from "react";
import { useProviderSubscriptionUsage } from "../hooks/useProviderSubscriptionUsage";
import styles from "./PolzaSidebarUsage.module.css";

function highestUsedPercent(usage: ProviderSubscriptionUsage | null): number | null {
  if (!usage?.windows.length) return null;
  return Math.round(Math.max(...usage.windows.map((window) => window.usedPercent)));
}

function UsageRow({
  provider,
  name,
}: {
  provider: ProviderName;
  name: string;
}) {
  const { usage, loading, error, supported, refresh } =
    useProviderSubscriptionUsage(provider);
  const [open, setOpen] = useState(false);
  const percent = highestUsedPercent(usage);

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-label={`${name}: ${percent === null ? "лимит недоступен" : `использовано до ${percent}%`}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className={`${styles.meter} ${provider === "claude" ? styles.claudeMeter : ""}`}
          style={{
            background:
              percent === null
                ? undefined
                : `conic-gradient(${provider === "claude" ? "#b77c5e" : "#7b8581"} ${percent}%, #e3e5e4 0)`,
          }}
          aria-hidden="true"
        >
          <span className={styles.meterCenter} />
        </span>
        <span>Использование {name}</span>
        <span className={styles.percent}>{percent === null ? "—" : `${percent}%`}</span>
      </button>
      {open && (
        <div className={styles.popover}>
          <div className={styles.heading}>
            <strong>Лимиты {name}</strong>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
            >
              Обновить
            </button>
          </div>
          {!supported ? (
            <p>Сервер не поддерживает показ лимитов.</p>
          ) : error ? (
            <p>Не удалось загрузить данные: {error.message}</p>
          ) : loading && !usage ? (
            <p>Загружаю…</p>
          ) : !usage || usage.windows.length === 0 ? (
            <p>Лимиты подписки для текущего подключения недоступны.</p>
          ) : (
            <ul className={styles.windows}>
              {usage.windows.map((window) => (
                <li key={window.id}>
                  <span>
                    {window.scope.type === "models"
                      ? (window.scope.label ?? window.scope.modelIds.join(", "))
                      : window.scope.category === "oauthApps"
                        ? "Приложения"
                        : "Все модели"}
                    {window.windowDurationMinutes
                      ? window.windowDurationMinutes < 60
                        ? ` · ${window.windowDurationMinutes} мин`
                        : ` · ${Math.round(window.windowDurationMinutes / 60)} ч`
                      : ""}
                    {window.resetsAt
                      ? ` · сброс ${new Date(window.resetsAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                      : ""}
                  </span>
                  <strong>{Math.round(window.usedPercent)}%</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function PolzaSidebarUsage() {
  return (
    <div className={styles.root}>
      <UsageRow provider="codex" name="Codex" />
      <UsageRow provider="claude" name="Claude" />
      <a
        className={styles.trigger}
        href="https://aistudio.google.com/usage?timeRange=last-28-days&tab=rate-limit"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Лимиты Gemini в Google AI Studio, откроется новая вкладка"
      >
        <span className={`${styles.meter} ${styles.geminiMeter}`} aria-hidden="true">
          <span className={styles.meterCenter} />
        </span>
        <span>Лимиты Gemini</span>
        <span className={styles.percent}>AI Studio ↗</span>
      </a>
    </div>
  );
}
