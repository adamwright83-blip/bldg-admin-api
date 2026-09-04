import type { FictionTemplate } from "../../../../../shared/fictionTemplate";

export const SEALED_DOORS_TEMPLATE: FictionTemplate = {
  id: "sealed-doors-v1",
  rulesVersion: 1,
  compatibleGrammarKinds: ["VISIT_LOCATION"],
  title: "SEALED DOORS",
  briefing: grammar =>
    `${grammar.count} aperture${grammar.count === 1 ? " is" : "s are"} shut on this street. Each door is a real address already on the books.`,
  physicalInstruction: grammar =>
    `Go to ${grammar.locations[0] ?? "the marked door"} and record the real visit result. Do not invent a manager.`,
  stakes: "A closed building is a closed building.",
  successTreatment: {
    headline: "DOOR ANSWERED",
    detail: "Whatever happened is what the visit outcome stored.",
  },
  failureTreatment: {
    headline: "STILL SEALED",
    detail: "The game setback does not mark the prospect lost.",
  },
  worldReturnTreatment: "door_attempted",
  timerEligible: false,
  drivingCompatible: false,
  attentionSafetyClass: "safe_walking",
  humanInteractionCompatible: false,
};
