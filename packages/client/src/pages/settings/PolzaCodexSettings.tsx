import type {
  EffortLevel,
  ModelInfo,
  ProviderName,
  NewSessionDefaults,
} from "@yep-anywhere/shared";
import { getModelEffortLevels } from "@yep-anywhere/shared";
import { useState } from "react";
import { useProviders } from "../../hooks/useProviders";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useSettingsPaneTitle } from "./SettingsPaneTitleContext";
import { ProviderSignIn } from "./ProviderSignIn";
import styles from "./PolzaCodexSettings.module.css";

const EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

function useCodexProvider() {
  const result = useProviders();
  return {
    ...result,
    codex: result.providers.find((item) => item.name === "codex"),
  };
}

export function PolzaCodexAccountSettings() {
  useSettingsPaneTitle("Аккаунт Codex");
  const { codex, loading, error, refetch } = useCodexProvider();
  const [showChange, setShowChange] = useState(false);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h2>Аккаунт Codex</h2>
        <p>Подключение CLI, через которое выполняются задачи на сервере.</p>
      </header>
      <section className={styles.card}>
        <div className={styles.cardTop}>
          <div>
            <h3>Серверный Codex CLI</h3>
            <p className={styles.muted}>
              Один аккаунт CLI используется для запуска задач. Чаты и права
              сотрудников хранятся отдельно в этом приложении.
            </p>
          </div>
          <span
            className={`${styles.status} ${codex?.authenticated ? styles.ready : ""}`}
          >
            {loading
              ? "Проверяем"
              : codex?.authenticated
                ? "Подключён"
                : "Не подключён"}
          </span>
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error.message}
          </p>
        )}
        {!loading && codex && (
          <div className={styles.details}>
            <span>CLI</span>
            <strong>{codex.installed ? "Установлен" : "Недоступен"}</strong>
            <span>Вход</span>
            <strong>
              {codex.authenticated
                ? (codex.user?.email ?? codex.user?.name ?? "Выполнен")
                : "Требуется"}
            </strong>
          </div>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className="settings-button"
            onClick={() => void refetch()}
          >
            Обновить статус
          </button>
          {codex?.supportsInAppLogin && codex.authenticated && (
            <button
              type="button"
              className="settings-button"
              onClick={() => setShowChange((value) => !value)}
              aria-expanded={showChange}
            >
              Сменить аккаунт CLI
            </button>
          )}
        </div>
        {codex?.supportsInAppLogin && (!codex.authenticated || showChange) && (
          <div className={styles.signIn}>
            {codex.authenticated && (
              <p className={styles.warning}>
                Смена аккаунта повлияет на новые и продолжаемые задачи всех
                сотрудников. История чатов останется на сервере.
              </p>
            )}
            <ProviderSignIn
              provider="codex"
              displayName="Codex"
              supportsHostTerminal={codex.supportsHostTerminalLogin === true}
              onSignedIn={() => {
                void refetch();
                setShowChange(false);
              }}
            />
          </div>
        )}
        {!loading && !codex && (
          <p role="alert" className={styles.error}>
            Сервер не сообщил статус Codex CLI.
          </p>
        )}
      </section>
    </div>
  );
}

export function PolzaCodexModelSettings() {
  useSettingsPaneTitle("Модели");
  const { providers, loading, error: providerError, refetch } = useProviders();
  const {
    settings,
    isLoading: settingsLoading,
    error: settingsError,
    updateSetting,
  } = useServerSettings();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const defaults = settings?.newSessionDefaults;
  const providerName = defaults?.provider ?? "codex";
  const provider = providers.find((item) => item.name === providerName);
  const models = provider?.models ?? [];
  const connected = providers.filter(
    (item) => item.installed && (item.authenticated || item.enabled),
  );
  const scoped = defaults?.providers?.[providerName];
  const modelId =
    scoped?.model ??
    (defaults?.provider === providerName ? defaults?.model : undefined) ??
    models.find((item) => item.isDefault)?.id ??
    models[0]?.id ??
    "";
  const model: ModelInfo | undefined = models.find(
    (item) => item.id === modelId,
  );
  const supportedEfforts = getModelEffortLevels(model).length
    ? getModelEffortLevels(model)
    : providerName === "codex"
      ? EFFORTS
      : [];
  const effort =
    scoped?.effortLevel ??
    model?.defaultEffortLevel ??
    (supportedEfforts.includes("medium")
      ? "medium"
      : (supportedEfforts[0] ?? "low"));

  const save = async (change: {
    provider?: ProviderName;
    model?: string;
    effortLevel?: EffortLevel;
  }) => {
    if (!settings) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    const nextProviderName = change.provider ?? providerName;
    const target = providers.find((item) => item.name === nextProviderName);
    const targetModels = target?.models ?? [];
    const targetScoped = defaults?.providers?.[nextProviderName];
    const candidateModel =
      change.model ??
      targetScoped?.model ??
      targetModels.find((item) => item.isDefault)?.id ??
      targetModels[0]?.id;
    const nextModel =
      targetModels.find((item) => item.id === candidateModel)?.id ??
      targetModels[0]?.id;
    if (!nextModel) {
      setSaving(false);
      return;
    }
    const nextInfo = targetModels.find((item) => item.id === nextModel);
    const modelEfforts = getModelEffortLevels(nextInfo);
    const nextEfforts = modelEfforts.length
      ? modelEfforts
      : nextProviderName === "codex"
        ? EFFORTS
        : [];
    const proposedEffort =
      change.effortLevel ??
      targetScoped?.effortLevel ??
      nextInfo?.defaultEffortLevel ??
      "medium";
    const nextEffort = nextEfforts.includes(proposedEffort)
      ? proposedEffort
      : nextEfforts[0];
    const next: NewSessionDefaults = {
      ...defaults,
      provider: nextProviderName,
      providers: {
        ...defaults?.providers,
        [nextProviderName]: {
          ...targetScoped,
          model: nextModel,
          ...(nextEffort ? { effortLevel: nextEffort } : {}),
        },
      },
    };
    try {
      await updateSetting("newSessionDefaults", next);
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h2>Модели</h2>
        <p>
          Модель и глубина рассуждения для новых чатов. В открытом чате выбор
          меняется в нижней панели.
        </p>
      </header>
      <section className={styles.card}>
        <div className={styles.cardTop}>
          <div>
            <h3>По умолчанию</h3>
            <p className={styles.muted}>
              Эти значения сохраняются на сервере для всей рабочей области.
            </p>
          </div>
        </div>
        {(providerError || settingsError || saveError) && (
          <p role="alert" className={styles.error}>
            {saveError || providerError?.message || settingsError}
          </p>
        )}
        {!loading && !settingsLoading && !provider?.authenticated && (
          <p className={styles.warning}>
            Этот сервис пока не подключён. Выбери доступный сервис или проверь
            его аккаунт.
          </p>
        )}
        <label className={styles.field}>
          <span>Сервис</span>
          <select
            value={providerName}
            disabled={loading || settingsLoading || saving}
            onChange={(event) =>
              void save({ provider: event.target.value as ProviderName })
            }
          >
            {!connected.some((item) => item.name === providerName) && (
              <option value={providerName}>
                {provider?.displayName ?? providerName}
              </option>
            )}
            {connected.map((item) => (
              <option key={item.name} value={item.name}>
                {item.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Модель</span>
          <select
            value={modelId}
            disabled={
              loading || settingsLoading || saving || models.length === 0
            }
            onChange={(event) => void save({ model: event.target.value })}
          >
            {models.length === 0 && (
              <option value="">Нет доступных моделей</option>
            )}
            {models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {supportedEfforts.length > 0 && (
          <label className={styles.field}>
            <span>Глубина рассуждения</span>
            <select
              value={effort}
              disabled={
                loading || settingsLoading || saving || models.length === 0
              }
              onChange={(event) =>
                void save({ effortLevel: event.target.value as EffortLevel })
              }
            >
              {supportedEfforts.map((item) => (
                <option key={item} value={item}>
                  {item === "low"
                    ? "Низкая"
                    : item === "medium"
                      ? "Средняя"
                      : item === "high"
                        ? "Высокая"
                        : item === "xhigh"
                          ? "Очень высокая"
                          : "Максимальная"}
                </option>
              ))}
            </select>
          </label>
        )}
        {saved && (
          <p role="status" className={styles.success}>
            Сохранено для новых чатов
          </p>
        )}
        <button
          type="button"
          className="settings-button"
          onClick={() => void refetch()}
        >
          Обновить список моделей
        </button>
      </section>
    </div>
  );
}
