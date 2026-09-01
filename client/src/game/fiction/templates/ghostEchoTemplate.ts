import type { FictionTemplate } from "../../../../../shared/fictionTemplate";

export const GHOST_ECHO_TEMPLATE: FictionTemplate = {
  id: "ghost-echo-v1",
  rulesVersion: 1,
  compatibleGrammarKinds: ["RECOVER_FAILED_CONTACT"],
  title: "GHOST ECHO",
  briefing: grammar =>
    `A dormant lantern still knows this street. ${grammar.count} real relationship${grammar.count === 1 ? "" : "s"} can be reached without a countdown.`,
  physicalInstruction: grammar =>
    `Attempt the real recovery contact. Record the true result. The world holds its breath; there is no combat and no timer.`,
  stakes: "No answer is no answer. The ghost remains until evidence says otherwise.",
  successTreatment: {
    headline: "THE SIGNAL ANSWERED",
    detail: "Only a persisted recovery outcome changed the relationship.",
  },
  failureTreatment: {
    headline: "THE ECHO FADES",
    detail: "A missed game beat does not mark the customer lost.",
  },
  worldReturnTreatment: "ghost_contacted",
  timerEligible: false,
  drivingCompatible: false,
  attentionSafetyClass: "safe_stationary",
  humanInteractionCompatible: true,
};
