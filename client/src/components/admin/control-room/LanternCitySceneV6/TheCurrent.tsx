import { formatVerifiedDelta, type EconomicReaction } from "@shared/economicReaction";
import styles from "./the-current.module.css";

/**
 * One authored consequence. The plaque text is the verified delta.
 * Nothing is drawn when eligibility returned no reaction.
 */
export function TheCurrent({ reaction }: { reaction: EconomicReaction | null }) {
  if (!reaction) return null;
  const plaque = formatVerifiedDelta(reaction.deltaCents);
  return (
    <div className={styles.current} data-reaction={reaction.reactionId} aria-hidden="true">
      <svg className={styles.canal} viewBox="0 0 1200 280" preserveAspectRatio="none">
        <path className={styles.bed} d="M0 190 C 180 150, 320 230, 520 180 S 860 120, 1200 170" />
        <path className={styles.flow} d="M0 190 C 180 150, 320 230, 520 180 S 860 120, 1200 170" />
        <path className={styles.waterline} d="M0 208 C 180 176, 320 246, 520 198 S 860 146, 1200 186" />
      </svg>
      <span className={styles.window} style={{ left: "18%", top: "42%" }} />
      <span className={styles.window} style={{ left: "46%", top: "34%" }} />
      <span className={styles.window} style={{ left: "71%", top: "40%" }} />
      <span className={styles.wheel} />
      <span className={styles.bird} />
      <p className={styles.plaque}>{plaque}</p>
    </div>
  );
}
