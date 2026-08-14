/**
 * NEUTRALIZE — the canonical immersion fixture proving the fiction system.
 *
 * Real business: a frozen route of genuine commercial visits. A stop is
 * covered only when its existing authoritative commercial visit outcome is
 * persisted; the fiction layer cannot certify it.
 *
 * Fiction: a counter-terrorism containment operation. A device is believed
 * hidden somewhere in the sector; every marked property requires a
 * neutralizer before containment fails.
 *
 * The title and briefing are fiction-first per the Fiction Integrity Copy
 * Gate — never "Distribute N stops", never "Pause the mission and go do
 * business work". The physical instruction stays operationally unambiguous:
 * it names the real count and says "record the visit result", because
 * an entertaining mission still has to tell the player's body what to
 * actually do.
 */
import type { FictionTemplate } from "../../../../../shared/fictionTemplate";

export const NEUTRALIZE_TEMPLATE: FictionTemplate = {
  id: "neutralize-v1",
  rulesVersion: 1,
  compatibleGrammarKinds: ["PLACE_ITEM_AT_LOCATIONS"],
  title: "NEUTRALIZE",
  briefing: grammar =>
    `A device has compromised this sector. Intelligence has marked ${grammar.count} commercial sites that must be secured before containment fails.`,
  physicalInstruction: grammar =>
    `Visit each of the ${grammar.count} marked commercial locations and record the real visit result. A location is secured only after its commercial visit outcome is saved.`,
  stakes:
    "Containment fails if even one marked property is left uncovered when the window closes.",
  successTreatment: {
    headline: "SECTOR CONTAINED",
    detail: "Every commercial visit is recorded. The sector is secured.",
  },
  failureTreatment: {
    headline: "CONTAINMENT WINDOW CLOSED",
    detail:
      "The fictional window closed. This does not affect the real route — it is not lost, and any legitimately-covered locations remain evidenced exactly as they were.",
  },
  worldReturnTreatment: "sector_secured",
  timerEligible: true,
  drivingCompatible: true, // route travel may require driving; runtime pauses the countdown until parked
  attentionSafetyClass: "safe_walking",
  humanInteractionCompatible: false,
};
