import { describe, expect, it } from "vitest";
import { buildDaphneClairePromptSection, isDaphneV2ClaireEnabled } from "./claireAdapter";
import type { DaphneOperatorCard } from "./operatorCard";
const base:DaphneOperatorCard={
 kind:"compiled_daphne_operator_card",canonical:false,tenantId:"t",canonicalOperatorId:"o",agentId:"claire",generatedAt:"2026-10-07T00:00:00Z",
 person:[],state:null,context:null,goals:[],relationship:null,metaPreferences:{adaptation_enabled:true,response_directness:.9},
 hypotheses:[],responseModel:[],guardrails:{mayMutateBusinessTruth:false,mayMintNarrativeDisclosure:false,personalityInferenceEnabled:true,crossAgentSharingEnabled:false},evidenceRefs:[]
};
describe("Daphne V2 Claire adapter",()=>{
 it("is off unless explicitly enabled",()=>expect(isDaphneV2ClaireEnabled("t",{} as any)).toBe(false));
 it("produces bounded non-authoritative style guidance",()=>{
  const s=buildDaphneClairePromptSection({
    ...base,
    metaPreferences:{
      adaptation_enabled:true,
      response_directness:.9,
      response_detail:.2,
      avoid_repetition:true,
    },
  })!;
  expect(s).toContain("interaction style only");
  expect(s).toContain("not business truth");
  expect(s).toContain("0.90");
  expect(s).toContain("lead with the answer or action");
  expect(s).toContain("keep the response concise");
  expect(s).toContain("do not repeat a question");
 });
 it("honors explicit adaptation disablement",()=>expect(buildDaphneClairePromptSection({...base,metaPreferences:{adaptation_enabled:false}})).toBeNull());
 it("honors memory recall disablement",()=>expect(buildDaphneClairePromptSection({...base,metaPreferences:{memory_recall:false}})).toBeNull());
});
