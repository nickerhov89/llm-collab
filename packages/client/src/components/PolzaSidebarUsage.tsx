import type { ModelUsageSummary, ProviderName } from "@yep-anywhere/shared";
import { useProviders } from "../hooks/useProviders";
import { useState } from "react";
import { useProviderSubscriptionUsage } from "../hooks/useProviderSubscriptionUsage";
import { useModelUsage } from "../hooks/useModelUsage";
import styles from "./PolzaSidebarUsage.module.css";

function ProviderUsage({
  provider,
  label: providerLabel,
  connected = true,
  summary,
}: {
  provider: ProviderName;
  label: string;
  connected?: boolean;
  summary?: ModelUsageSummary | null;
}) {
  const { usage, loading, error, supported, refresh } =
    useProviderSubscriptionUsage(connected ? provider : null);
  const [open, setOpen] = useState(false);
  const windows =
    usage?.windows.filter(
      (window) =>
        Number.isFinite(window.usedPercent) &&
        window.usedPercent >= 0 &&
        window.usedPercent <= 100,
    ) ?? [];
  // Connected models remain selectable; only reported quota data belongs here.
  const native = provider === "codex" || provider === "claude";
  const hasQuota = supported && !error && windows.length > 0;
  if (!hasQuota && !native) return null;
  const stats = native ? summary?.transports?.[provider] : null;
  const percent = hasQuota
    ? Math.round(Math.max(...windows.map((window) => window.usedPercent)))
    : null;
  const label = `${providerLabel}: ${percent === null ? (stats ? `${stats.requests} запросов через OpenRouter` : "данные подписки недоступны") : `использовано до ${percent}%`}`;

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
        <span>{providerLabel}</span>
        <span className={styles.percent}>
          {percent === null
            ? stats
              ? `${stats.requests} запр.`
              : summary?.account
                ? "API"
                : "Нет данных"
            : `${percent}%`}
        </span>
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
          {!hasQuota && (
            <p>
              {summary?.account
                ? "Работает через OpenRouter. Лимиты подписки здесь не используются."
                : "Провайдер не сообщил лимиты подписки. Это не нулевой расход."}
            </p>
          )}
          {stats && (
            <p>
              По API с начала нового учёта: {dollars(stats.confirmed)} ·{" "}
              {stats.requests} запросов. Неподтверждённый резерв:{" "}
              {dollars(stats.unverified)}.
            </p>
          )}
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

const dollars = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

function RouterCounter({
  summary,
  loading,
  refresh,
}: {
  summary: ModelUsageSummary | null;
  loading: boolean;
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const billing = summary?.billing;
  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className={styles.meter} aria-hidden="true">
          R
        </span>
        <span>OpenRouter</span>
        <span className={styles.percent}>
          {billing ? dollars(billing.spentToday) : loading ? "…" : "Нет данных"}
        </span>
      </button>
      {open && (
        <div className={styles.popover}>
          <div className={styles.heading}>
            <strong>Расходы OpenRouter</strong>
            <button
              type="button"
              disabled={loading}
              onClick={() => void refresh()}
            >
              Обновить
            </button>
          </div>
          {billing ? (
            <>
              <p>
                Сегодня по API: <strong>{dollars(billing.spentToday)}</strong> ·{" "}
                {summary?.account ? "общий ключ сотрудников" : "ключ владельца"}{" "}
                · UTC.
              </p>
              {billing.creditBalance !== null && (
                <p>Баланс аккаунта: {dollars(billing.creditBalance)}.</p>
              )}
              {billing.keyRemaining !== null && (
                <p>
                  Доступно ключу: {dollars(billing.keyRemaining)}
                  {billing.keyLimit !== null
                    ? ` из ${dollars(billing.keyLimit)}`
                    : ""}
                  . Это отдельный лимит ключа.
                </p>
              )}
              <p>
                {billing.stale ? "Последние сохранённые данные" : "Обновлено"}:{" "}
                {new Date(billing.fetchedAt).toLocaleTimeString()}.
              </p>
            </>
          ) : (
            <p>Нет ответа API. Расход не подменяется нулём.</p>
          )}
          {summary?.account && (
            <>
              <p>
                Ваш бюджет: {dollars(summary.dailyBudget ?? 0)}/день.
                Подтверждено с начала нового учёта:{" "}
                {dollars(summary.confirmedSinceTracking)}.
              </p>
              <p>
                В работе: {summary.active}/{summary.concurrency} · очередь:{" "}
                {summary.queued}. Резерв активных запросов:{" "}
                {dollars(summary.inflightReserved)}.
              </p>
              <p>
                Старый учёт, верхняя оценка: {dollars(summary.legacyUpperBound)}
                . Неподтверждённые списания:{" "}
                {dollars(summary.unverifiedReserved)}.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PolzaSidebarUsage() {
  const { providers } = useProviders();
  const { usage: summary, loading, refresh } = useModelUsage();
  const connected = providers.filter(
    (provider) =>
      provider.installed && (provider.authenticated || provider.enabled),
  );
  return (
    <section aria-label="Использование моделей">
      {(["codex", "claude"] as const).map((name) => (
        <ProviderUsage
          key={name}
          provider={name}
          label={name === "codex" ? "Codex" : "Claude"}
          connected={connected.some((p) => p.name === name)}
          summary={summary}
        />
      ))}
      {connected
        .filter((p) => p.name !== "codex" && p.name !== "claude")
        .map((provider) => (
          <ProviderUsage
            key={provider.name}
            provider={provider.name}
            label={provider.displayName}
          />
        ))}
      <RouterCounter summary={summary} loading={loading} refresh={refresh} />
    </section>
  );
}
