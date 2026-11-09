import { useState } from "react";
import { useProviderSubscriptionUsage } from "../hooks/useProviderSubscriptionUsage";
import styles from "./PolzaSidebarUsage.module.css";

export function PolzaSidebarUsage() {
  const { usage, loading, error, supported, refresh } =
    useProviderSubscriptionUsage("codex");
  const [open, setOpen] = useState(false);
  const highest = usage?.windows.length
    ? Math.max(...usage.windows.map((window) => window.usedPercent))
    : undefined;
  const percent = highest === undefined ? null : Math.round(highest);
  const label =
    percent === null ? "Использование" : `Использовано до ${percent}%`;

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className={styles.meter}
          style={{
            background:
              percent === null
                ? undefined
                : `conic-gradient(#7b8581 ${percent}%, #e3e5e4 0)`,
          }}
          aria-hidden="true"
        >
          <span className={styles.meterCenter} />
        </span>
        <span>Использование Codex</span>
        {percent !== null && <span className={styles.percent}>{percent}%</span>}
      </button>
      {open && (
        <div className={styles.popover}>
          <div className={styles.heading}>
            <strong>Лимиты Codex</strong>
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
            <p>Аккаунт пока не сообщает об использовании.</p>
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
