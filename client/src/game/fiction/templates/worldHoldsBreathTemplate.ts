import type { FictionTemplate } from "../../../../../shared/fictionTemplate";

export const WORLD_HOLDS_BREATH_TEMPLATE: FictionTemplate = {
  id: "world-holds-breath-v1",
  rulesVersion: 1,
  compatibleGrammarKinds: ["CALL_PERSON"],
  title: "THE WORLD HOLDS ITS BREATH",
  briefing: () =>
    `A real conversation is about to happen inside the adventure. Combat is quiet. The Gold Line stays attached. There is no timer.`,
  physicalInstruction: () =>
    `Make the real call. Stay in the adventure. Do not treat this as a boss fight or a countdown.`,
  stakes: "A flashing prompt over a human voice would sabotage the work.",
  successTreatment: {
    headline: "THE CITY EXHALES",
    detail: "The call is whatever was actually logged. The game did not score it.",
  },
  failureTreatment: {
    headline: "THE LINE STAYS OPEN",
    detail: "Missing a game beat did not hang up the real conversation.",
  },
  worldReturnTreatment: "conversation_sanctuary",
  timerEligible: false,
  drivingCompatible: false,
  attentionSafetyClass: "safe_stationary",
  humanInteractionCompatible: true,
};
