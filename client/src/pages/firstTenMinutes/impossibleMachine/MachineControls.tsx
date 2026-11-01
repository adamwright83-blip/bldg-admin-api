import { motion, useReducedMotion } from "framer-motion";
import type { MachineDialState } from "./machineTypes";
import styles from "./impossibleMachine.module.css";

interface MachineControlsProps {
  dial: MachineDialState;
  crankSpinning: boolean;
  disabled: boolean;
  routeConnected: boolean;
  domeUnlocked?: boolean;
  onToggleDial: () => void;
  onWindCrank: () => void;
  onScrollToEnding?: () => void;
}

/**
 * Physical THEN/NOW dial at the upper edge of the machine, and the brass wind-up crank at the lower edge.
 * Operable by mouse, touch, and keyboard, with >= 44x44 CSS-pixel touch targets.
 */
export function MachineControls({
  dial,
  crankSpinning,
  disabled,
  routeConnected,
  domeUnlocked = false,
  onToggleDial,
  onWindCrank,
  onScrollToEnding,
}: MachineControlsProps) {
  const reduce = useReducedMotion();

  const handleCrankClick = domeUnlocked && onScrollToEnding ? onScrollToEnding : onWindCrank;
  const handleDialClick = domeUnlocked && onScrollToEnding ? onScrollToEnding : onToggleDial;

  return (
    <>
      {/* Physical THEN / NOW Dial at upper edge */}
      <div className={styles.dialHousing} data-testid="machine-dial-housing" data-dial={dial}>
        <img
          src="/assets/first-ten/impossible-machine/dial-details.png"
          alt=""
          className={styles.dialOrnament}
          draggable={false}
        />
        <button
          type="button"
          className={styles.dialButton}
          onClick={handleDialClick}
          disabled={disabled && !domeUnlocked}
          aria-label={
            domeUnlocked
              ? "Rescue complete. Contraption solved."
              : `Time configuration dial: currently ${dial}. Activate to switch between THEN and NOW.`
          }
          data-testid="machine-dial-toggle"
          data-state={dial}
        >
          <span className={`${styles.dialPosition} ${dial === "THEN" ? styles.dialPositionActive : ""}`}>
            THEN
          </span>
          <motion.span
            className={styles.dialPointer}
            animate={{ rotate: dial === "THEN" ? -28 : 28 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 240, damping: 18 }}
          />
          <span className={`${styles.dialPosition} ${dial === "NOW" ? styles.dialPositionActive : ""}`}>
            NOW
          </span>
        </button>
      </div>

      {/* Brass Wind-up Crank at lower edge */}
      <div className={styles.crankHousing} data-testid="machine-crank-housing">
        <button
          type="button"
          className={`${styles.crankButton} ${domeUnlocked ? styles.crankComplete : routeConnected ? styles.crankReady : ""}`}
          onClick={handleCrankClick}
          disabled={disabled && !domeUnlocked}
          aria-label={
            domeUnlocked
              ? "Rescue complete. Contraption solved — view finale below."
              : "Wind the brass crank to run the railway carriage"
          }
          data-testid="machine-wind-crank"
          data-connected={routeConnected ? "yes" : "no"}
          data-completed={domeUnlocked ? "yes" : "no"}
        >
          <motion.span
            className={styles.crankWheel}
            animate={crankSpinning && !reduce ? { rotate: 360 } : { rotate: 0 }}
            transition={{ duration: 0.65, ease: "easeInOut" }}
          >
            <span className={styles.crankSpoke} />
            <span className={styles.crankHandleKnob} />
          </motion.span>
          <span className={styles.crankLabel}>
            {domeUnlocked
              ? "RESCUE COMPLETE · VIEW FINALE ↓"
              : crankSpinning
                ? "WINDING…"
                : "WIND CRANK"}
          </span>
        </button>
      </div>
    </>
  );
}
