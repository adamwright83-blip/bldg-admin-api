import type { ActionGrammarKind } from "./actionGrammar";
import type { FictionTemplate } from "./fictionTemplate";

function stub(input: {
  id: string;
  compatibleGrammarKinds: readonly ActionGrammarKind[];
  timerEligible: boolean;
  drivingCompatible: boolean;
  attentionSafetyClass: FictionTemplate["attentionSafetyClass"];
  humanInteractionCompatible: boolean;
}): FictionTemplate {
  return {
    ...input,
    rulesVersion: 1,
    title: input.id,
    briefing: () => "",
    physicalInstruction: () => "",
    stakes: "",
    successTreatment: { headline: "", detail: "" },
    failureTreatment: { headline: "", detail: "" },
    worldReturnTreatment: "",
  };
}

/**
 * Safety/eligibility metadata for production templates, without importing the
 * client fiction pack. Eligibility still runs through `eligibleTemplates`.
 */
export const FICTION_ELIGIBILITY_CATALOG: readonly FictionTemplate[] = [
  stub({
    id: "neutralize-v1",
    compatibleGrammarKinds: ["PLACE_ITEM_AT_LOCATIONS"],
    timerEligible: true,
    drivingCompatible: true,
    attentionSafetyClass: "safe_walking",
    humanInteractionCompatible: false,
  }),
  stub({
    id: "beacon-walk-v1",
    compatibleGrammarKinds: ["VISIT_LOCATION"],
    timerEligible: false,
    drivingCompatible: false,
    attentionSafetyClass: "safe_walking",
    humanInteractionCompatible: false,
  }),
  stub({
    id: "sealed-doors-v1",
    compatibleGrammarKinds: ["VISIT_LOCATION"],
    timerEligible: false,
    drivingCompatible: false,
    attentionSafetyClass: "safe_walking",
    humanInteractionCompatible: false,
  }),
  stub({
    id: "lantern-survey-v1",
    compatibleGrammarKinds: ["INSPECT_LOCATION"],
    timerEligible: false,
    drivingCompatible: false,
    attentionSafetyClass: "safe_walking",
    humanInteractionCompatible: false,
  }),
  stub({
    id: "corridor-trace-v1",
    compatibleGrammarKinds: ["INSPECT_LOCATION"],
    timerEligible: false,
    drivingCompatible: false,
    attentionSafetyClass: "safe_walking",
    humanInteractionCompatible: false,
  }),
  stub({
    id: "ghost-echo-v1",
    compatibleGrammarKinds: ["RECOVER_FAILED_CONTACT"],
    timerEligible: false,
    drivingCompatible: false,
    attentionSafetyClass: "safe_stationary",
    humanInteractionCompatible: true,
  }),
  stub({
    id: "held-breath-v1",
    compatibleGrammarKinds: ["FOLLOW_UP_PERSON"],
    timerEligible: false,
    drivingCompatible: false,
    attentionSafetyClass: "safe_stationary",
    humanInteractionCompatible: true,
  }),
  stub({
    id: "watch-gate-v1",
    compatibleGrammarKinds: ["WAIT_FOR_EVENT"],
    timerEligible: false,
    drivingCompatible: false,
    attentionSafetyClass: "safe_stationary",
    humanInteractionCompatible: false,
  }),
  stub({
    id: "world-holds-breath-v1",
    compatibleGrammarKinds: ["CALL_PERSON"],
    timerEligible: false,
    drivingCompatible: false,
    attentionSafetyClass: "safe_stationary",
    humanInteractionCompatible: true,
  }),
];

