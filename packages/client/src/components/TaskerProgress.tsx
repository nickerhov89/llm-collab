import { useEffect, useState, type CSSProperties } from "react";
import { Modal } from "./ui/Modal";
import { useI18n } from "../i18n";
import {
  TASKER_BADGES,
  type BadgeId,
  type taskerProgress,
} from "../lib/taskerProgress";
import styles from "./TaskerProgress.module.css";
export interface TaskerCelebration {
  id: number;
  level: number;
  leveled: boolean;
  badges: BadgeId[];
}
export function TaskerProgress({
  progress,
  unlocked,
  celebration,
}: {
  progress: ReturnType<typeof taskerProgress>;
  unlocked: BadgeId[];
  celebration: TaskerCelebration | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!celebration) return;
    setShow(true);
    const timer = setTimeout(() => setShow(false), 4200);
    return () => clearTimeout(timer);
  }, [celebration]);
  return (
    <>
      <button
        type="button"
        className={styles.summary}
        onClick={() => setOpen(true)}
        aria-label={t("taskerOpenRewards")}
      >
        <span className={styles.level}>{progress.level}</span>
        <span className={styles.stats}>
          <strong>{t("taskerLevel", { level: progress.level })}</strong>
          <progress
            value={progress.intoLevel}
            max={progress.needed}
            aria-label={t("taskerExperience")}
          />
          <small>
            {progress.intoLevel} / {progress.needed} XP · {unlocked.length} / 24{" "}
            {t("taskerRewards")}
          </small>
        </span>
        <span aria-hidden="true">↗</span>
      </button>
      {show && celebration && (
        <div
          key={celebration.id}
          className={`${styles.celebration} ${celebration.leveled ? styles.levelUp : ""}`}
          role="status"
        >
          <div className={styles.sparkles} aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <i key={i} style={{ "--particle": i } as CSSProperties} />
            ))}
          </div>
          <span className={styles.celebrationIcon} aria-hidden="true">
            {celebration.leveled ? "★" : "✓"}
          </span>
          <div>
            <strong>
              {celebration.leveled
                ? t("taskerLevelUp", { level: celebration.level })
                : t("taskerXpEarned")}
            </strong>
            <p>
              {celebration.badges.length
                ? celebration.badges
                    .map((id) => t(`taskerBadge_${id}`))
                    .join(" · ")
                : t("taskerKeepGoing")}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("taskerDismissReward")}
            onClick={() => setShow(false)}
          >
            ×
          </button>
        </div>
      )}
      {open && (
        <Modal
          title={`${t("taskerRewards")} · ${unlocked.length}/24`}
          onClose={() => setOpen(false)}
        >
          <p className={styles.intro}>{t("taskerRewardRules")}</p>
          <div className={styles.grid}>
            {TASKER_BADGES.map(([id, icon]) => (
              <article
                key={id}
                className={`${styles.badge} ${unlocked.includes(id) ? styles.earned : ""}`}
              >
                <span aria-hidden="true">{icon}</span>
                <div>
                  <strong>{t(`taskerBadge_${id}`)}</strong>
                  <small>{t(`taskerBadgeHint_${id}`)}</small>
                </div>
                <span
                  className={styles.check}
                  role="img"
                  aria-label={t(
                    unlocked.includes(id) ? "taskerUnlocked" : "taskerLocked",
                  )}
                >
                  {unlocked.includes(id) ? "✓" : "·"}
                </span>
              </article>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
