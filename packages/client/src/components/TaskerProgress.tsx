import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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
const cheers = [
  ["Красиво закрыл!", "Одним делом меньше. Дышится легче.", "✓"],
  ["Минус задача, плюс кайф", "Забирай свои +25 XP. Ты их заработал.", "↗"],
  ["Вот это темп!", "Маленькая победа тоже считается.", "✦"],
  [
    "Сделано. Можно выдохнуть",
    "Ещё один пункт больше не висит над головой.",
    "✓",
  ],
  ["Ты сегодня в ударе", "Продолжай в своём ритме.", "✶"],
  ["Плюс один повод гордиться", "Дело двигается — и это твоя заслуга.", "↗"],
  ["Так держать!", "Большие результаты собираются из таких шагов.", "✦"],
  ["Задача сдалась", "А ты стал на 25 XP опытнее.", "✓"],
  ["Хорошая работа", "Не обязательно успеть всё. Этот шаг уже сделан.", "✶"],
  ["Ещё ближе к цели", "Сегодняшний ты помог завтрашнему себе.", "↗"],
  ["Есть контакт!", "План превращается в результат.", "✦"],
  ["Можно поставить галочку", "И на секунду порадоваться. Заслуженно.", "✓"],
] as const;

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
  const [cheerIndex, setCheerIndex] = useState(0);
  useEffect(() => {
    if (!celebration) return;
    // Rotate with the completion count, rather than changing copy on rerenders.
    setCheerIndex(progress.completed % cheers.length);
    setShow(true);
    const timer = setTimeout(() => setShow(false), 4200);
    return () => clearTimeout(timer);
  }, [celebration, progress.completed]);
  const cheer = cheers[cheerIndex] ?? cheers[0];
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
      {show &&
        celebration &&
        createPortal(
          <div
            key={celebration.id}
            className={styles.sparkles}
            aria-hidden="true"
          >
            {Array.from({ length: 40 }, (_, i) => (
              <i
                key={i}
                style={
                  {
                    "--particle": i,
                    "--x": `${(i * 37) % 100}%`,
                    "--drift": `${((i * 53) % 240) - 120}px`,
                    "--delay": `${(i % 8) * 0.055}s`,
                    "--duration": `${1.6 + (i % 5) * 0.2}s`,
                  } as CSSProperties
                }
              />
            ))}
          </div>,
          document.body,
        )}
      {show && celebration && (
        <div
          key={celebration.id}
          className={`${styles.celebration} ${celebration.leveled ? styles.levelUp : ""}`}
          data-tone={cheerIndex % 4}
          role="status"
        >
          <span className={styles.celebrationIcon} aria-hidden="true">
            {celebration.leveled ? "★" : cheer[2]}
          </span>
          <div>
            <strong>
              {celebration.leveled
                ? `Новый уровень — ${celebration.level}!`
                : cheer[0]}
            </strong>
            <span className={styles.xp}>+25 XP</span>
            <p>
              {celebration.badges.length
                ? "И новая награда в коллекции. Забирай!"
                : celebration.leveled
                  ? "Растёшь над собой. Вот это приятно."
                  : cheer[1]}
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
