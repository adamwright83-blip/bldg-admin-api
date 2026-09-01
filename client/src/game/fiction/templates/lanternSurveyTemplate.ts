import type { FictionTemplate } from "../../../../../shared/fictionTemplate";

export const LANTERN_SURVEY_TEMPLATE: FictionTemplate = {
  id: "lantern-survey-v1",
  rulesVersion: 1,
  compatibleGrammarKinds: ["INSPECT_LOCATION"],
  title: "LANTERN SURVEY",
  briefing: grammar =>
    `The city wants a true look at ${grammar.count} marked place${grammar.count === 1 ? "" : "s"}. No timer. No combat.`,
  physicalInstruction: grammar =>
    `Inspect ${grammar.locations[0] ?? "the location"} and capture only what you can actually see or confirm.`,
  stakes: "A false observation would poison the Chronicle.",
  successTreatment: {
    headline: "SURVEY TAKEN",
    detail: "Only evidenced facts entered the world.",
  },
  failureTreatment: {
    headline: "SURVEY BROKEN",
    detail: "Nothing was invented. The building is unchanged.",
  },
  worldReturnTreatment: "survey_complete",
  timerEligible: false,
  drivingCompatible: false,
  attentionSafetyClass: "safe_walking",
  humanInteractionCompatible: false,
};
