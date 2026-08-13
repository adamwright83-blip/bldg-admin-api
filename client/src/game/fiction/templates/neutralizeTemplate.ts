/**
 * NEUTRALIZE — the canonical immersion fixture proving the fiction system.
 *
 * Real business: a genuine multi-stop route (`PLACE_ITEM_AT_LOCATIONS`,
 * `ActionGrammar.count` real due `nearby_commercial_visit` field moves — see
 * shared/actionGrammar.ts's documented discrepancy note on why this is a
 * real route rather than a fabricated "door-hanger placement" domain).
 *
 * Fiction: a counter-terrorism containment operation. A device is believed
 * hidden somewhere in the sector; every marked property requires a
 * neutralizer before containment fails.
 *
 * The title and briefing are fiction-first per the Fiction Integrity Copy
 * Gate — never "Distribute N stops", never "Pause the mission and go do
 * business work". The physical instruction stays operationally unambiguous:
 * it names the real count and says "visit every required location", because
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
    `A device has been hidden somewhere inside this sector. Intelligence cannot isolate the structure. Deploy one neutralizer at every one of the ${grammar.count} marked properties before containment fails.`,
  physicalInstruction: grammar =>
    `Take the ${grammar.count} marked tags from your kit. Follow the marked route. Place one at every required front-door location — every marked property must be covered.`,
  stakes:
    "Containment fails if even one marked property is left uncovered when the window closes.",
  successTreatment: {
    headline: "SECTOR CONTAINED",
    detail: "Every marked property is covered. The device threat is neutralized.",
  },
  failureTreatment: {
    headline: "CONTAINMENT WINDOW CLOSED",
    detail:
      "The fictional window closed. This does not affect the real route — it is not lost, and any legitimately-covered locations remain evidenced exactly as they were.",
  },
  worldReturnTreatment: "sector_secured",
  timerEligible: true,
  drivingCompatible: false, // a walking multi-stop placement route only — never while driving
  attentionSafetyClass: "safe_walking",
  humanInteractionCompatible: false,
};
