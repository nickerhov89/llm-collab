import type { ProviderName } from "@yep-anywhere/shared";
import { useProviders } from "../hooks/useProviders";
import { useState } from "react";
import { useProviderSubscriptionUsage } from "../hooks/useProviderSubscriptionUsage";
import styles from "./PolzaSidebarUsage.module.css";

function ProviderUsage({
  provider,
  label: providerLabel,
}: {
  provider: ProviderName;
  label: string;
}) {
  const { usage, loading, error, supported, refresh } =
    useProviderSubscriptionUsage(provider);
  const [open, setOpen] = useState(false);
  const windows =
    usage?.windows.filter(
      (window) =>
        Number.isFinite(window.usedPercent) &&
        window.usedPercent >= 0 &&
        window.usedPercent <= 100,
    ) ?? [];
  // Connected models remain selectable; only reported quota data belongs here.
  if (!supported || error || windows.length === 0) return null;
  const percent = Math.round(
    Math.max(...windows.map((window) => window.usedPercent)),
  );
  const label = `Использовано до ${percent}%`;

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
            background: `conic-gradient(#7b8581 ${percent}%, #e3e5e4 0)`,
          }}
          aria-hidden="true"
        >
          <span className={styles.meterCenter} />
        </span>
        <span>{providerLabel}</span>
        <span className={styles.percent}>{percent}%</span>
      </button>
      {open && (
        <div className={styles.popover}>
          <div className={styles.heading}>
            <strong>Лимиты {providerLabel}</strong>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
            >
              Обновить
            </button>
          </div>
          <ul className={styles.windows}>
            {windows.map((window) => (
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
        </div>
      )}
    </div>
  );
}

export function PolzaSidebarUsage() {
  const { providers } = useProviders();
  const connected = providers.filter(
    (provider) =>
      provider.installed && (provider.authenticated || provider.enabled),
  );
  return (
    <section aria-label="Использование моделей">
      {connected.map((provider) => (
        <ProviderUsage
          key={provider.name}
          provider={provider.name}
          label={provider.displayName}
        />
      ))}
    </section>
  );
}
