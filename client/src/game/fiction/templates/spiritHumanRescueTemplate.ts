import type { FictionTemplate } from "../../../../../shared/fictionTemplate";
import { SPIRIT_HUMAN_RESCUE_TEMPLATE_ID } from "../../../../../shared/spiritHumanRescue";

/**
 * Presentation wrapper for dormant-customer outreach.
 * The ActionGrammar / send boundary does not change when this template binds.
 */
export const SPIRIT_HUMAN_RESCUE_TEMPLATE: FictionTemplate = {
  id: SPIRIT_HUMAN_RESCUE_TEMPLATE_ID,
  rulesVersion: 1,
  compatibleGrammarKinds: ["FOLLOW_UP_PERSON"],
  title: "SPIRIT HUMAN RESCUE",
  briefing: () =>
    "A JOYSTICK villager is caged. Their Spirit Human is a real dormant customer. Sending approved outreach is the rescue. A reply or order is a later world event.",
  physicalInstruction: () =>
    "Prepare the real message, edit if needed, and send only after you explicitly approve. Do not do this while driving.",
  stakes: "The cage is fiction. The text is real. Silence after send is still silence.",
  successTreatment: {
    headline: "THE LINK HELD",
    detail: "The provider accepted the outbound message. The villager is rescued. The customer has not been claimed as reactivated.",
  },
  failureTreatment: {
    headline: "THE SIGNAL BROKE",
    detail: "No send receipt. The villager stays caged. Retry is allowed.",
  },
  worldReturnTreatment: "spirit_human_outreach_sent",
  timerEligible: false,
  drivingCompatible: false,
  attentionSafetyClass: "safe_stationary",
  humanInteractionCompatible: true,
};
