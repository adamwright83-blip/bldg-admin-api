import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { recordDaphneObservation, normalizeDaphneObservationInput } from "./observationStore";
import { recordDaphneEpistemicClaim, listDaphneEpistemicClaims, normalizeDaphneEpistemicClaim } from "./epistemicStore";
import { buildDaphneV2OperatorCard } from "./engine";
import { buildDaphneClairePromptSection } from "./claireAdapter";
import { correctDaphneClaim, inspectDaphneClaim, rejectDaphneClaim } from "./userControls";
import { setDaphneMetaPreference } from "./goalsPreferences";
import { deleteDaphneV2UserData } from "./privacy";
import { getDb } from "../../db";
import { daphneEpistemicClaims, daphneObservations } from "../../../drizzle/schema";

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
  it("inspects and corrects evidence older than the last 500 rows without crossing operator boundaries", async () => {
    const db = await getDb();
    if (!db) throw new Error("No disposable test database");
    const oldObservation = await recordDaphneObservation({
      ...scope, actorType: "user", observationKind: "user_statement",
      evidenceChannel: "stated", verificationStatus: "attested",
      sourceType: "certification", sourceReference: "historical-inspection",
      occurredAt: new Date("2026-01-01T00:00:00Z"),
      payload: { fact: "historical" }, idempotencyKey: "historical-inspection",
    });
    const oldClaim = await recordDaphneEpistemicClaim({
      ...scope, claimType: "direct_fact", claimKey: "historical-inspection",
      claim: { fact: "historical" }, sourceObservationIds: [oldObservation.id],
      modelVersion: "certification", idempotencyKey: "historical-inspection",
    });
    // Make over 500 newer records without relying on timestamp ties or
    // issuing a thousand individual database writes.
    const newerTime = new Date(Date.now() + 60_000);
    const observations = Array.from({ length: 505 }, (_, index) =>
      normalizeDaphneObservationInput({
        ...scope, actorType: "user", observationKind: "user_statement",
        evidenceChannel: "stated", verificationStatus: "attested",
        sourceType: "certification", sourceReference: `inspection-new-${index}`,
        occurredAt: newerTime, idempotencyKey: `inspection-obs-${index}`,
        payload: { index },
      })
    );
    await db.insert(daphneObservations).values(
      observations.map(observation => ({ ...observation, createdAt: newerTime }))
    );
    const claims = observations.map((observation, index) =>
      normalizeDaphneEpistemicClaim({
        ...scope, claimType: "direct_fact", claimKey: `inspection-new-${index}`,
        claim: { index }, sourceObservationIds: [observation.id],
        modelVersion: "certification", idempotencyKey: `inspection-claim-${index}`,
      })
    );
    await db.insert(daphneEpistemicClaims).values(
      claims.map(claim => ({ ...claim, createdAt: newerTime }))
    );

    expect((await listDaphneEpistemicClaims({ ...scope, limit: 500 }))
      .some(claim => claim.id === oldClaim.id)).toBe(false);
    const inspection = await inspectDaphneClaim({ ...scope, claimId: oldClaim.id });
    expect(inspection.claim.id).toBe(oldClaim.id);
    expect(inspection.sourceObservations.map(observation => observation.id))
      .toContain(oldObservation.id);
    await expect(inspectDaphneClaim({
      tenantId, canonicalOperatorId: "operator-b", claimId: oldClaim.id,
    })).rejects.toThrow("Daphne claim not found");
    const correction = await correctDaphneClaim({
      ...scope, operatorUserId: "operator-a", actorId: "operator-a",
      claimId: oldClaim.id, correctedClaim: { fact: "corrected" },
    });
    expect(correction.supersedesClaimId).toBe(oldClaim.id);
    expect((await inspectDaphneClaim({ ...scope, claimId: correction.id })).claim.id)
      .toBe(correction.id);
  });

});
