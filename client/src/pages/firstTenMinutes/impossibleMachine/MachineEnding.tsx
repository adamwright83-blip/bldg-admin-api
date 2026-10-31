import { motion, useReducedMotion } from "framer-motion";
import type { DraftStatus } from "@shared/firstTenMinutesChapter";
import type { MachineEngineState } from "./machineTypes";
import styles from "./impossibleMachine.module.css";

interface MachineEndingProps {
  state: MachineEngineState;
  draftStatus?: DraftStatus | null;
  onContinueToPage?: () => void;
  children?: React.ReactNode;
}

/**
 * State I — Completed adventure banner & comedic ending beat.
 * Once Rook steps out of the dome, he notices the machine is unattended and attempts to maneuver it into his satchel.
 * Invites the player onward into JOYSTICK without requiring a real business action as a prerequisite.
 */
export function MachineEnding({ state, draftStatus = null, onContinueToPage, children }: MachineEndingProps) {
  const reduce = useReducedMotion();

  const outcomeKind =
    draftStatus === "verified_sent" || draftStatus === "reported_sent" || state.centerBridgeRestored
      ? "sent"
      : draftStatus === "declined"
        ? "not_now"
        : null;

  if (!state.domeUnlocked && !outcomeKind) return null;

  return (
    <motion.section
      className={styles.endingBanner}
      data-testid="machine-ending-banner"
      data-outcome={outcomeKind ?? "rescued"}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className={styles.endingCard} data-testid="first-ten-closing" data-outcome={outcomeKind ?? "not_now"}>
        <div className={styles.endingVisualCol}>
          <img
            src="/assets/first-ten/impossible-machine/rook-stealing.png"
            alt="Rook trying to stuff the machine into his satchel"
            className={styles.endingStealArt}
            data-testid="machine-rook-stealing"
            draggable={false}
          />
        </div>
        <div className={styles.endingTextCol}>
          <span className={styles.endingTag}>
            {state.domeUnlocked ? "DOME UNLOCKED · ROOK IS FREE" : "CENTRAL COUPLING UPDATED"}
          </span>
          <h2 className={styles.endingTitle}>
            {state.domeUnlocked
              ? "Rook checks that no one is looking, then tries to slide the entire railway into his satchel."
              : outcomeKind === "sent"
                ? "The central brass bridge locked into place."
                : "The note stays tucked in the brass clip for later."}
          </h2>
          <p className={styles.endingSub}>
            {outcomeKind === "sent"
              ? "Your message went out from your Gmail. Hazel notices the ink on your hand. Rook has already claimed the central turntable as salvage."
              : "The lower NOW turntable carries the key home. Rook is already trying to fold the brass chimney so the machine fits in his bag."}
          </p>
          {state.domeUnlocked && onContinueToPage ? (
            <div className={styles.endingActions}>
              <button
                type="button"
                className={styles.continueJoystickBtn}
                onClick={onContinueToPage}
                data-testid="first-ten-back-to-page"
              >
                Back to your page
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {children}
    </motion.section>
  );
}
