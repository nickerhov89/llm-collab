import { useI18n } from "../i18n";
import {
  defaultWorkProfile,
  WORK_ROLES,
  type WorkProfile,
  type WorkRole,
} from "../lib/polzaWorkProfile";
import styles from "./PolzaWorkProfileEditor.module.css";
export function PolzaWorkProfileEditor({
  value,
  disabled,
  onChange,
}: {
  value: WorkProfile | null;
  disabled?: boolean;
  onChange: (profile: WorkProfile, commit: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <section className={styles.profile} aria-label={t("workProfileTitle")}>
      <h4>{t("workProfileTitle")}</h4>
      <label>
        {t("workRole")}
        <select
          disabled={disabled}
          value={value?.role ?? ""}
          onChange={(e) => {
            if (e.target.value)
              onChange(defaultWorkProfile(e.target.value as WorkRole), true);
          }}
        >
          <option value="" disabled>
            {t("workChooseRole")}
          </option>
          {WORK_ROLES.map((role) => (
            <option key={role} value={role}>
              {t(`workRole_${role}`)}
            </option>
          ))}
        </select>
      </label>
      {value && (
        <>
          <label>
            {t("workPriorities")}
            <textarea
              disabled={disabled}
              rows={3}
              maxLength={2000}
              value={value.priorities}
              onChange={(e) =>
                onChange({ ...value, priorities: e.target.value }, false)
              }
            />
          </label>
          <label>
            {t("workPeriod")}
            <input
              disabled={disabled}
              maxLength={100}
              value={value.period}
              onChange={(e) =>
                onChange({ ...value, period: e.target.value }, false)
              }
            />
          </label>
          {value.kpis.map((kpi, index) => (
            <fieldset key={kpi.id} disabled={disabled}>
              <legend>{t(`workKpi_${kpi.id}`)}</legend>
              <label>
                {t("workKpiTarget")}
                <input
                  maxLength={100}
                  placeholder={t("workTargetPlaceholder")}
                  value={kpi.target}
                  onChange={(e) =>
                    onChange(
                      {
                        ...value,
                        kpis: value.kpis.map((k, i) =>
                          i === index ? { ...k, target: e.target.value } : k,
                        ),
                      },
                      false,
                    )
                  }
                />
              </label>
              <label>
                {t("workKpiWeight")}
                <select
                  value={kpi.weight}
                  onChange={(e) =>
                    onChange(
                      {
                        ...value,
                        kpis: value.kpis.map((k, i) =>
                          i === index
                            ? { ...k, weight: Number(e.target.value) }
                            : k,
                        ),
                      },
                      true,
                    )
                  }
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
          ))}
          <p>{t("workProfileHint")}</p>
        </>
      )}
    </section>
  );
}
