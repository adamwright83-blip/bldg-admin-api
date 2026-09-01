import type { FictionTemplate } from "../../../../../shared/fictionTemplate";

export const CORRIDOR_TRACE_TEMPLATE: FictionTemplate = {
  id: "corridor-trace-v1",
  rulesVersion: 1,
  compatibleGrammarKinds: ["INSPECT_LOCATION"],
  title: "CORRIDOR TRACE",
  briefing: grammar =>
    `Gold dust still hangs in this corridor. ${grammar.count} place${grammar.count === 1 ? "" : "s"} need a truthful look before the line moves on.`,
  physicalInstruction: grammar =>
    `Inspect ${grammar.locations[0] ?? "the marked place"} and save only what you observed.`,
  stakes: "The corridor cannot be rewritten to look prettier than the coordinates.",
  successTreatment: {
    headline: "TRACE COMPLETE",
    detail: "The inspection is evidenced. Geography did not move.",
  },
  failureTreatment: {
    headline: "TRACE LOST",
    detail: "A game miss does not erase the real place.",
  },
  worldReturnTreatment: "corridor_traced",
  timerEligible: false,
  drivingCompatible: false,
  attentionSafetyClass: "safe_walking",
  humanInteractionCompatible: false,
};
