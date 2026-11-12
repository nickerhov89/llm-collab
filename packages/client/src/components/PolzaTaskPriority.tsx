import { useI18n } from "../i18n";
import {
  emptyTaskPriority,
  type TaskPriority,
  type WorkProfile,
} from "../lib/polzaWorkProfile";
import styles from "./PolzaWorkProfileEditor.module.css";
export function PolzaTaskPriority({
  value,
  profile,
  disabled,
  onChange,
}: {
  value?: TaskPriority;
  profile: WorkProfile | null;
  disabled: boolean;
  onChange: (next: TaskPriority, delayed?: boolean) => void;
}) {
  const { t } = useI18n();
  const p = value ?? emptyTaskPriority;
  return (
    <section className={styles.profile} aria-label={t("taskerPriorityTitle")}>
      <h4>{t("taskerPriorityTitle")}</h4>
      {!profile ? (
        <p>{t("taskerMissingWorkProfile")}</p>
      ) : (
        <>
          <label>
            {t("taskerKpi")}
            <select
              disabled={disabled}
              value={p.kpi ?? ""}
              onChange={(e) =>
                onChange({
                  ...p,
                  kpi: (e.target.value as TaskPriority["kpi"]) || undefined,
                })
              }
            >
              <option value="">{t("taskerChooseKpi")}</option>
              {profile.kpis.map((k) => (
                <option key={k.id} value={k.id}>
                  {t(`workKpi_${k.id}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("taskerImpact")}
            <select
              disabled={disabled}
              value={p.impact}
              onChange={(e) =>
                onChange({ ...p, impact: Number(e.target.value) })
              }
            >
              {([1, 2, 3] as const).map((n) => (
                <option key={n} value={n}>
                  {t(`taskerImpact_${n}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("taskerHours")}
            <select
              disabled={disabled}
              value={p.hours}
              onChange={(e) =>
                onChange({ ...p, hours: Number(e.target.value) })
              }
            >
              {[...new Set([0.25, 0.5, 1, 2, 4, 8, 16, 40, p.hours])]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t("taskerDue")}
            <input
              type="date"
              disabled={disabled}
              value={p.due}
              onChange={(e) => onChange({ ...p, due: e.target.value })}
            />
          </label>
          <label>
            {t("taskerImpactReason")}
            <textarea
              disabled={disabled}
              maxLength={2000}
              rows={3}
              value={p.reason}
              placeholder={t("taskerImpactPlaceholder")}
              onChange={(e) => onChange({ ...p, reason: e.target.value }, true)}
            />
          </label>
          <label>
            <span>
              <input
                type="checkbox"
                disabled={disabled}
                checked={p.blocked}
                onChange={(e) => onChange({ ...p, blocked: e.target.checked })}
              />{" "}
              {t("taskerBlocked")}
            </span>
          </label>
        </>
      )}
    </section>
  );
}
