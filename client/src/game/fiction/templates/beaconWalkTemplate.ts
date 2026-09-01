import type { FictionTemplate } from "../../../../../shared/fictionTemplate";

export const BEACON_WALK_TEMPLATE: FictionTemplate = {
  id: "beacon-walk-v1",
  rulesVersion: 1,
  compatibleGrammarKinds: ["VISIT_LOCATION"],
  title: "BEACON WALK",
  briefing: grammar =>
    `A lantern along the Gold Line has gone dim. Intelligence marked ${grammar.count} real ${grammar.count === 1 ? "site" : "sites"} that must be walked in person.`,
  physicalInstruction: grammar =>
    `Visit ${grammar.locations[0] ?? "the marked location"} and record what actually happened. The fiction cannot certify the stop.`,
  stakes: "The line stays thin until the real visit is evidenced.",
  successTreatment: {
    headline: "BEACON RELIT",
    detail: "The visit is recorded. The building is whatever the evidence says.",
  },
  failureTreatment: {
    headline: "THE WALK BROKE",
    detail: "The fictional walk ended. The real visit is unchanged unless a visit outcome was saved.",
  },
  worldReturnTreatment: "beacon_walked",
  timerEligible: false,
  drivingCompatible: false,
  attentionSafetyClass: "safe_walking",
  humanInteractionCompatible: false,
};
