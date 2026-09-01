import type { FictionTemplate } from "../../../../../shared/fictionTemplate";

export const WATCH_GATE_TEMPLATE: FictionTemplate = {
  id: "watch-gate-v1",
  rulesVersion: 1,
  compatibleGrammarKinds: ["WAIT_FOR_EVENT"],
  title: "WATCH THE GATE",
  briefing: grammar =>
    `A real event has not happened yet. The campaign waits with you — it does not invent a deadline.`,
  physicalInstruction: grammar =>
    `Wait for the real ${grammar.locations[0] ?? "event"} to occur. Do not treat this as a combat timer.`,
  stakes: "Honesty is the only mechanic. The gate opens when reality does.",
  successTreatment: {
    headline: "THE GATE OPENED",
    detail: "The wait ended because the real event happened.",
  },
  failureTreatment: {
    headline: "STILL WAITING",
    detail: "The game cannot make the event arrive sooner.",
  },
  worldReturnTreatment: "honest_wait",
  timerEligible: false,
  drivingCompatible: false,
  attentionSafetyClass: "safe_stationary",
  humanInteractionCompatible: false,
};
