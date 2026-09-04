import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { dayforgeSaasExternalCustomers, goldlineWorldEvents } from "../../drizzle/schema";
import type { FirstMission, GoldlineOnboardingSession, WorldAnchor } from "../../shared/goldlineOnboarding";
import { compileLocalWorld } from "../../shared/goldlineLocalWorld";
import { GUARDIAN_ROSTER_IDS } from "../../shared/goldlineGuardians";
import { stableHash } from "../../shared/goldlineTerritories";
import { GoogleGeocoder } from "../geography/googleGeocoder";
import { onboardingDb, readSession, resultRows, saveSession } from "./store";

export function buildFirstMission(session:GoldlineOnboardingSession,checkpoint:WorldAnchor,territoryId:string):FirstMission {
 const profile=session.interpretation!.profile;
 return {id:`first-${session.id}`,archetype:"TERRITORY_SCOUT",title:`Scout ${checkpoint.label}`,objective:`Visit a publicly accessible spot near ${checkpoint.label}. Look for one concrete next step toward: ${profile.objective90Day}. Record what you actually observed, including if nothing useful happened.`,avoidance:profile.avoidancePattern,guardianId:GUARDIAN_ROSTER_IDS[stableHash(profile.avoidancePattern)%GUARDIAN_ROSTER_IDS.length],territoryId,checkpoint,status:"active",outcome:null,traversalCompletedAt:null,gameplayCompletedAt:null};
}
export async function importedCustomers(tenantId:string){const db=await onboardingDb();return db.select().from(dayforgeSaasExternalCustomers).where(and(eq(dayforgeSaasExternalCustomers.tenantId,tenantId),eq(dayforgeSaasExternalCustomers.providerKey,"goldline_customer_csv")));}
export async function revealWorld(tenantId:string){
 const session=await readSession(tenantId);if(!session?.interpretation)throw new Error("Interpret your five answers first.");if(session.status==="COMPLETE")return session;
 // The concise geocodable name resolves to one area; the fuller description is
 // prose and resolves to whatever business happens to sit inside it. Sessions
 // interpreted before this field existed fall back to the description.
 const profile=session.interpretation.profile as typeof session.interpretation.profile & {geocodableServiceArea?:string};
 const geo=await new GoogleGeocoder().geocode(profile.geocodableServiceArea?.trim()||profile.localServiceAreaDescription);
 if(geo.status!=="success")throw new Error("Your service area could not be resolved confidently. Your answers are saved; retry when geocoding is available or clarify your service area.");
 const area:WorldAnchor={id:`area-${session.id}`,label:geo.canonicalAddress,latitude:geo.latitude,longitude:geo.longitude,provenance:"geocoded_declaration",evidenceId:null};
 const anchors:WorldAnchor[]=[area];
 for(const customer of await importedCustomers(tenantId)){
  const facts=customer.factsJson as any;const location=facts?.geography;
  if(location?.status==="success"&&Number.isFinite(location.latitude)&&Number.isFinite(location.longitude))anchors.push({id:`customer-${customer.id}`,label:customer.name,latitude:location.latitude,longitude:location.longitude,provenance:"imported_evidence",evidenceId:`external-customer:${customer.id}`});
 }
 const topology=compileLocalWorld({tenantId,label:geo.canonicalAddress,anchors,extentKm:geo.extentKm});
 const mission=buildFirstMission(session,area,topology.territories.find(t=>t.anchorIds.includes(area.id))!.id);
 return saveSession({...session,status:"COMPLETE",completedAt:new Date().toISOString(),world:{mode:"LOCAL_PHYSICAL",skinId:"WATER_LAND",topologyId:topology.id,topologyRevision:topology.revision,compositionRevision:1,topology},mission,version:session.version+1},session.version);
}
export async function mutateFirstMission(tenantId:string,actorId:string,missionId:string,action:{kind:"traversal"}|{kind:"defeat"}|{kind:"outcome";text:string;gps:FirstMission["outcome"] extends infer T ? {latitude:number;longitude:number;accuracy:number}|null : never}){
 const db=await onboardingDb();
 return db.transaction(async tx=>{
  const rows=resultRows(await tx.execute(sql`SELECT payload FROM goldline_onboarding_sessions WHERE tenantId=${tenantId} FOR UPDATE`));
  const session:GoldlineOnboardingSession|undefined=rows[0]?(typeof rows[0].payload==="string"?JSON.parse(rows[0].payload):rows[0].payload):undefined;
  const mission=session?.mission;if(!session||session.status!=="COMPLETE"||!mission||mission.id!==missionId)throw new Error("Mission not found in this tenant.");
  const now=new Date().toISOString();
  if(action.kind==="traversal")mission.traversalCompletedAt??=now;
  else if(action.kind==="outcome"){
   if(!mission.traversalCompletedAt)throw new Error("Cross the first game passage before recording this mission's field outcome.");
   if(!mission.outcome){
    mission.outcome={text:action.text,reportedAt:now,actorId,provenance:"operator_reported",gps:action.gps};
    mission.status="completed";
    await tx.insert(goldlineWorldEvents).values({id:randomUUID(),tenantId,physicalEntityId:null,eventType:"territory_scout_observed",classification:"evidence",actorType:"operator",actorId,occurredAt:new Date(now),observedAt:new Date(now),sourceType:"goldline_first_mission",sourceId:mission.id,sourceEvidenceReference:`first-mission:${mission.id}:outcome`,provenanceClass:"operator_reported",verificationClass:"ATTESTED",confidence:"medium",idempotencyKey:`first-mission:${mission.id}:outcome`,correlationId:mission.id,metadataJson:{text:action.text,gpsContext:action.gps,territoryId:mission.territoryId,checkpoint:mission.checkpoint,claims:{sale:false,conversation:false,handoff:false}}});
   }
  }else{
   if(!mission.outcome)throw new Error("Legitimate field evidence must unlock the Guardian first.");
   if(!mission.gameplayCompletedAt){mission.gameplayCompletedAt=now;await tx.insert(goldlineWorldEvents).values({id:randomUUID(),tenantId,physicalEntityId:null,eventType:"guardian_defeated",classification:"game_projection",actorType:"operator",actorId,occurredAt:new Date(now),sourceType:"goldline_first_mission",sourceId:mission.id,sourceEvidenceReference:`first-mission:${mission.id}:game`,provenanceClass:"generated_game_fiction",verificationClass:"CLAIMED",confidence:"unknown",idempotencyKey:`first-mission:${mission.id}:game`,correlationId:mission.id,metadataJson:{territoryId:mission.territoryId,guardianId:mission.guardianId}});}
  }
  session.version+=1;
  await tx.execute(sql`UPDATE goldline_onboarding_sessions SET payload=${JSON.stringify(session)},version=${session.version} WHERE tenantId=${tenantId}`);
  return session;
 });
}
