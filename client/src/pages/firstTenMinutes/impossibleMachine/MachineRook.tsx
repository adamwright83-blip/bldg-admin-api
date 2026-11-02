import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { MACHINE_HEIGHT, MACHINE_NODES, MACHINE_WIDTH } from "./machineGraph";
import type { MachineEngineState } from "./machineTypes";
import styles from "./impossibleMachine.module.css";

interface MachineRookProps {
  state: MachineEngineState;
  unlockStage: "locked" | "key_inserted" | "tumblers_turning" | "dome_lifting" | "escaped" | "stealing";
}

/**
 * Rook's station at the left of the machine (x 12%, y 52%).
 * Renders:
 * 1. Separate character layer (`rook-trapped.png` without glass painted on him, `rook-free.png`, `rook-stealing.png`).
 * 2. Separate transparent glass dome overlay (`glass-dome.png`) that physically lifts when unlocked.
 * 3. Separate mechanical lock escutcheon (`lock-details.png`) with rotating brass tumblers.
 * 4. Rook's concise witty remark bubble.
 */
export function MachineRook({ state, unlockStage }: MachineRookProps) {
  const reduce = useReducedMotion();
  const domeNode = MACHINE_NODES.rook_dome;

  const isStealing = state.rookStealing || unlockStage === "stealing";
  const isFree = state.domeUnlocked || unlockStage === "escaped" || isStealing;
  const domeRaised =
    unlockStage === "dome_lifting" ||
    unlockStage === "escaped" ||
    isStealing ||
    state.domeUnlocked;

  const spriteSrc = isStealing
    ? "/assets/first-ten/impossible-machine/rook-stealing.png"
    : isFree
      ? "/assets/first-ten/impossible-machine/rook-free.png"
      : "/assets/first-ten/impossible-machine/rook-trapped.png";

  return (
    <div
      className={styles.rookDomeStation}
      style={{
        left: `${(domeNode.x / MACHINE_WIDTH) * 100}%`,
        top: `${(domeNode.y / MACHINE_HEIGHT) * 100}%`,
      }}
      data-testid="machine-rook-station"
      data-trapped={isFree ? "no" : "yes"}
      data-unlock-stage={unlockStage}
    >
      {/* Pedestal base */}
      <div className={styles.domePedestal} />

      {/* Rook character layer (independent from the glass dome overlay) */}
      <motion.div
        className={styles.rookCharacterLayer}
        animate={
          isStealing && !reduce
            ? { x: [0, 36, 28], y: [0, -10, -4], rotate: [0, 5, -3, 0] }
            : isFree && !reduce
              ? { x: 18, y: -8 }
              : { x: 0, y: 0 }
        }
        transition={{ duration: reduce ? 0 : 0.65, ease: "easeOut" }}
        data-testid="machine-rook"
        data-pose={isStealing ? "stealing" : isFree ? "free" : "trapped"}
      >
        <img
          src={spriteSrc}
          alt={
            isStealing
              ? "Rook trying to stuff the machine into his leather satchel"
              : isFree
                ? "Rook stepping free from the glass dome"
                : "Rook trapped under the glass dome"
          }
          className={styles.rookSprite}
          data-testid={isStealing ? "machine-rook-stealing" : isFree ? "machine-rook-free" : "machine-rook-trapped"}
          draggable={false}
        />
      </motion.div>

      {/* Separate Transparent Glass Dome Overlay */}
      <motion.div
        className={styles.glassDomeOverlay}
        animate={
          domeRaised
            ? { y: -220, opacity: isStealing ? 0.2 : 0.45, scale: 0.96 }
            : { y: 0, opacity: 1, scale: 1 }
        }
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 16 }}
        data-testid="machine-glass-dome"
        data-lifted={domeRaised ? "yes" : "no"}
      >
        <img
          src="/assets/first-ten/impossible-machine/glass-dome.png"
          alt="Glass dome overlay"
          className={styles.glassDomeSprite}
          data-testid="machine-glass-dome-img"
          draggable={false}
        />
      </motion.div>

      {/* Mechanical Lock & Brass Tumblers */}
      <div
        className={styles.domeLockMechanism}
        data-testid="machine-dome-lock"
        data-unlocked={state.domeUnlocked ? "yes" : "no"}
      >
        <motion.img
          src="/assets/first-ten/impossible-machine/lock-details.png"
          alt="Mechanical brass lock"
          className={styles.lockSprite}
          animate={
            unlockStage === "tumblers_turning" || state.domeUnlocked
              ? { rotate: 90 }
              : { rotate: 0 }
          }
          transition={{ duration: reduce ? 0 : 0.35 }}
          draggable={false}
        />
      </div>

      {/* Rook's witty remark bubble */}
      <AnimatePresence mode="wait">
        <motion.div
          key={state.rookLine}
          className={styles.rookSpeechBubble}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          data-testid="machine-rook-line"
        >
          <span className={styles.rookSpeechName}>Rook</span>
          <p className={styles.rookSpeechText}>{state.rookLine}</p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
