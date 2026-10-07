import { describe, expect, it } from "vitest";
import { daphneRelationshipContextForNarrator } from "./daphneRelationshipContext";
describe("Narrator OS Daphne relationship bridge",()=>{
 it("can carry stance context but never authority",()=>{
  const c=daphneRelationshipContextForNarrator({
   agentId:"claire",generatedAt:"2026-10-07T00:00:00Z",expectations:[],corrections:["x"],repairs:[],
   disclosures:[],sharedReferences:[],boundaries:["b"],preferences:[],unresolvedRuptures:["r"],
   sourceObservationIds:["obs"],relationshipHypothesisStatus:"evidence_only"
  })!;
  expect(c.stanceHints).toContain("relationship_repair_priority");
  expect(c.mayAuthorizeBeat).toBe(false); expect(c.mayAuthorizeDisclosure).toBe(false); expect(c.mayCreateNarrativeFact).toBe(false);
 });
});
