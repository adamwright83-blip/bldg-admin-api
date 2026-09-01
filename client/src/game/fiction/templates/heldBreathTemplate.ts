import type { FictionTemplate } from "../../../../../shared/fictionTemplate";

export const HELD_BREATH_TEMPLATE: FictionTemplate = {
  id: "held-breath-v1",
  rulesVersion: 1,
  compatibleGrammarKinds: ["FOLLOW_UP_PERSON"],
  title: "HELD BREATH",
  briefing: grammar =>
    `Someone real is waiting on a promise. The city does not rush ${grammar.count === 1 ? "this conversation" : "these conversations"}.`,
  physicalInstruction: grammar =>
    `Complete the real follow-up. There is no countdown, no flashing prompt, and no 'exit game to talk'.`,
  stakes: "Rushing this person would sabotage the actual relationship.",
  successTreatment: {
    headline: "THE PROMISE HELD",
    detail: "The follow-up is whatever was actually recorded.",
  },
  failureTreatment: {
    headline: "THE BREATH RELEASES",
    detail: "Arcade interruption did not close the real follow-up.",
  },
  worldReturnTreatment: "follow_up_inside_adventure",
  timerEligible: false,
  drivingCompatible: false,
  attentionSafetyClass: "safe_stationary",
  humanInteractionCompatible: true,
};
