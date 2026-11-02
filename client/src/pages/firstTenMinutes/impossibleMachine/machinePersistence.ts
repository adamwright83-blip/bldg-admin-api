import type { ChapterView, DraftView } from "@shared/firstTenMinutesChapter";
import { createInitialMachineState, ROOK_LINES } from "./machineState";
import type { CorrespondenceChoice, MachineEngineState } from "./machineTypes";

export function isCenterTrackRestored(draft: DraftView | null | undefined): boolean {
  return draft?.status === "verified_sent";
}



export interface StoredMachineProgress {
  keyRetrieved: boolean;
  centerExamined: boolean;
  correspondenceChoice: CorrespondenceChoice;
  returnCompleted: boolean;
  returnRouteUsed: "center" | "lower" | null;
  rookRescued: boolean;
  adventureCompleted: boolean;
}

/**
 * Reconstructs an honest playable MachineEngineState from persisted chapter/machine progress and draft state.
 * Also supports legacy compatibility: if a user already completed the previous chapter (`letterWritten: true`
 * or `draft !== null`), we reconstruct them cleanly into the return puzzle or completed state without
 * forcing them through an incompatible sequence or resending a message.
 */
export function hydrateMachineStateFromChapter(
  chapter: ChapterView | null | undefined,
  machineProgress?: Partial<StoredMachineProgress> | null
): MachineEngineState {
  const base = createInitialMachineState();
  if (!chapter && !machineProgress) return base;

  const draft = chapter?.draft ?? null;
  const legacyRevealed = Boolean(chapter?.progress?.revealed);
  const legacyLetterWritten = Boolean(chapter?.progress?.letterWritten);

  const verifiedSent = draft?.status === "verified_sent";
  const keyRetrieved = Boolean(
    machineProgress?.keyRetrieved ||
      legacyRevealed ||
      legacyLetterWritten ||
      draft !== null ||
      verifiedSent
  );

  let correspondenceChoice: CorrespondenceChoice = machineProgress?.correspondenceChoice ?? null;
  if (!correspondenceChoice && draft) {
    correspondenceChoice = draft.status === "declined" ? "not_for_me" : "prepare_reply";
  }

  const centerExamined = Boolean(
    machineProgress?.centerExamined ||
      correspondenceChoice !== null ||
      draft !== null ||
      legacyLetterWritten
  );

  const rookRescued = Boolean(machineProgress?.rookRescued || machineProgress?.adventureCompleted);
  const adventureCompleted = Boolean(machineProgress?.adventureCompleted);
  const returnCompleted = Boolean(machineProgress?.returnCompleted || rookRescued);
  const returnRouteUsed =
    machineProgress?.returnRouteUsed ??
    (returnCompleted ? (verifiedSent ? "center" : "lower") : null);

  if (!keyRetrieved) {
    return base;
  }

  if (adventureCompleted || rookRescued) {
    const finalRoute = returnRouteUsed ?? (verifiedSent ? "center" : "lower");
    return {
      ...base,
      phase: adventureCompleted ? "completed" : "dome_unlocked",
      dial: "NOW",
      westJunction: finalRoute === "center" ? "center" : "lower",
      eastJunction: finalRoute === "center" ? "center" : "lower",
      upperRotor: "aligned",
      lowerRotor: finalRoute === "lower" ? "aligned" : "misaligned",
      keyRetrieved: true,
      centerExamined,
      correspondenceChoice,
      centerBridgeRestored: verifiedSent,
      returnRouteUsed: finalRoute,
      domeUnlocked: true,
      rookRescued: true,
      rookStealing: adventureCompleted,
      adventureCompleted,
      rookLine: adventureCompleted ? ROOK_LINES.stealing : ROOK_LINES.domeUnlocked,
    };
  }

  // Key is retrieved, currently on the return puzzle / correspondence stage
  return {
    ...base,
    phase: verifiedSent
      ? "center_restored"
      : correspondenceChoice
        ? "choice_made"
        : centerExamined
          ? "center_examined"
          : "return_puzzle",
    dial: "NOW",
    westJunction: verifiedSent ? "center" : "upper",
    eastJunction: verifiedSent ? "center" : "upper",
    upperRotor: "aligned",
    lowerRotor: "misaligned",
    keyRetrieved: true,
    centerExamined,
    correspondenceChoice,
    centerBridgeRestored: verifiedSent,
    returnRouteUsed: null,
    domeUnlocked: false,
    rookRescued: false,
    rookStealing: false,
    adventureCompleted: false,
    rookLine: verifiedSent
      ? ROOK_LINES.centerRestored
      : correspondenceChoice === "prepare_reply"
        ? ROOK_LINES.choicePrepare
        : correspondenceChoice === "keep_for_later"
          ? ROOK_LINES.choiceLater
          : correspondenceChoice === "not_for_me"
            ? ROOK_LINES.choiceDecline
            : centerExamined
              ? ROOK_LINES.centerExamined
              : ROOK_LINES.machineShifts,
  };
}
