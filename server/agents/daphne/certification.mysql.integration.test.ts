import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { recordDaphneObservation } from "./observationStore";
import { recordDaphneEpistemicClaim, listDaphneEpistemicClaims } from "./epistemicStore";
import { buildDaphneV2OperatorCard } from "./engine";
import { buildDaphneClairePromptSection } from "./claireAdapter";
import { correctDaphneClaim, rejectDaphneClaim } from "./userControls";
import { setDaphneMetaPreference } from "./goalsPreferences";
import { deleteDaphneV2UserData } from "./privacy";

const describeMysql=process.env.DATABASE_URL?describe:describe.skip;
describeMysql("Daphne durable current-knowledge certification",()=>{
  const tenantId=`daphne-cert-${randomUUID().slice(0,12)}`;
  const canonicalOperatorId="operator-a";
  const scope={tenantId,canonicalOperatorId};
  const card=()=>buildDaphneV2OperatorCard({...scope,agentId:"claire"});
  afterAll(async()=>{
    await deleteDaphneV2UserData(scope);
    await deleteDaphneV2UserData({...scope,canonicalOperatorId:"operator-b"});
  });
  it("remembers, corrects, retrieves and rejects facts across independently compiled cards",async()=>{
    const observation=await recordDaphneObservation({...scope,agentId:"claire",sessionId:"call-a",
      actorType:"user",observationKind:"user_statement",evidenceChannel:"stated",verificationStatus:"attested",
      sourceType:"certification",sourceReference:"call-a:fact",occurredAt:new Date(),
      payload:{availability:"mornings"},idempotencyKey:"initial-fact"});
    const fact=await recordDaphneEpistemicClaim({...scope,agentId:"claire",claimType:"direct_fact",
      claimKey:"availability",claim:{availability:"mornings"},sourceObservationIds:[observation.id],
      uncertainty:{epistemic:0},modelVersion:"certification",idempotencyKey:"initial-fact"});
    const first=await card();
    expect(buildDaphneClairePromptSection(first)).toContain("mornings");
    const corrected=await correctDaphneClaim({...scope,operatorUserId:"operator-a",actorId:"operator-a",
      claimId:fact.id,correctedClaim:{availability:"afternoons"}});
    const second=await card();
    expect(buildDaphneClairePromptSection(second)).toContain("afternoons");
    expect(buildDaphneClairePromptSection(second)).not.toContain("mornings");
    expect(second.evidenceRefs).toContain(corrected.id);
    const history=await listDaphneEpistemicClaims({...scope,limit:500});
    expect(history.find(c=>c.id===fact.id)?.claim).toEqual({availability:"mornings"});
    expect(history.find(c=>c.id===corrected.id)?.supersedesClaimId).toBe(fact.id);
    await rejectDaphneClaim({...scope,operatorUserId:"operator-a",actorId:"operator-a",claimId:corrected.id});
    expect(buildDaphneClairePromptSection(await card())).not.toContain("afternoons");
  });
  it("isolates agent-specific knowledge and operator knowledge",async()=>{
    for(const item of [{agentId:"other",canonicalOperatorId},{agentId:"claire",canonicalOperatorId:"operator-b"}]){
      const obs=await recordDaphneObservation({...scope,...item,actorType:"user",observationKind:"user_statement",
        evidenceChannel:"stated",verificationStatus:"attested",sourceType:"certification",sourceReference:item.agentId,
        occurredAt:new Date(),payload:{private:"private-secret"},idempotencyKey:`private-${item.agentId}`});
      await recordDaphneEpistemicClaim({...scope,...item,claimType:"direct_fact",claimKey:"private",
        claim:{private:"private-secret"},sourceObservationIds:[obs.id],modelVersion:"certification",idempotencyKey:`private-${item.agentId}`});
    }
    expect(JSON.stringify(await card())).not.toContain("private-secret");
  });
  it("keeps revoked adaptation disabled on a newly loaded card",async()=>{
    const obs=await recordDaphneObservation({...scope,actorType:"user",observationKind:"correction",
      evidenceChannel:"stated",verificationStatus:"attested",sourceType:"certification",sourceReference:"revoke",
      occurredAt:new Date(),idempotencyKey:"revoke"});
    await setDaphneMetaPreference({...scope,preferenceKey:"adaptation_enabled",value:true,
      sourceObservationId:obs.id,status:"revoked"});
    expect(buildDaphneClairePromptSection(await card())).toBeNull();
  });
});
