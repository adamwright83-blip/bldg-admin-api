import { describe, expect, it } from "vitest";
import { recommendDaphneRelationshipRepair } from "./repairEngine";
describe("Daphne V2 rupture/repair intelligence",()=>{
 it("never resolves an unknown rupture by inventing the user's motive",()=>{
  const r=recommendDaphneRelationshipRepair({
   agentId:"claire",generatedAt:"x",expectations:[],corrections:[],repairs:[],disclosures:[],sharedReferences:[],boundaries:[],preferences:[],
   unresolvedRuptures:["repeated-question"],sourceObservationIds:["1"],relationshipHypothesisStatus:"evidence_only"
  });
  expect(r.action).toBe("ask_repair_question"); expect(r.forbiddenMoves).toContain("claiming_intent");
 });
});
