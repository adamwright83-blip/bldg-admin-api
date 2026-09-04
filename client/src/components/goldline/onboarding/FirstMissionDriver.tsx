import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { GoldlineOnboardingSession } from "@shared/goldlineOnboarding";
import type { TerritoryDefinition, TerritoryDerivedState } from "@shared/goldlineTerritories";
import GoldlineOverworld from "@/pages/goldline/GoldlineOverworld";
import { GuardianEncounter } from "../GuardianEncounter";
import { guardianById } from "@shared/goldlineGuardians";
import "../goldline-territories.css";
import "./onboarding.css";
export function FirstMissionDriver({session}:{session:GoldlineOnboardingSession}){
 const mission=session.mission!;
 const utils=trpc.useUtils();
 const refresh=()=>utils.system.goldlineOnboarding.state.invalidate();
 const traversal=trpc.system.goldlineOnboarding.traversal.useMutation({onSuccess:refresh});
 const report=trpc.system.goldlineOnboarding.fieldOutcome.useMutation({onSuccess:()=>{setBriefing(false);void refresh();}});
 const defeat=trpc.system.goldlineOnboarding.defeat.useMutation({onSuccess:refresh});
 const [briefing,setBriefing]=useState(false),[text,setText]=useState(""),[confirmed,setConfirmed]=useState(false),[encounter,setEncounter]=useState(false);
 const [gps,setGps]=useState<{latitude:number;longitude:number;accuracy:number}|null>(null),[gpsStatus,setGpsStatus]=useState("GPS optional; confirm your own presence below.");
 const guardian=guardianById(mission.guardianId);
 const definition:TerritoryDefinition=useMemo(()=>({id:mission.territoryId,tenantId:session.tenantId,stableKey:mission.id,version:1,fantasyTitle:mission.title,realGeographyLabel:mission.checkpoint.label,grammar:"visit_hunt",guardianId:mission.guardianId,members:[],geometryMode:"cluster",createdFrom:"first_mission",publishedAt:session.completedAt!,classification:"game_projection"}),[mission.id,mission.territoryId,mission.guardianId,mission.title,mission.checkpoint.label,session.tenantId,session.completedAt]);
 const state:TerritoryDerivedState=useMemo(()=>({territoryId:mission.territoryId,stableKey:mission.id,version:1,readiness:mission.outcome?"confrontation_ready":"veiled",completedMemberIds:[],remainingMemberIds:[],members:[],confrontationReady:Boolean(mission.outcome),cleared:Boolean(mission.gameplayCompletedAt),clearedAt:mission.gameplayCompletedAt,clearedEventId:null,guardianId:mission.guardianId,evidenceRevisedAfterClear:false}),[mission.id,mission.territoryId,mission.outcome,mission.gameplayCompletedAt,mission.guardianId]);
 return <main className="gl-first-mission" data-testid="first-mission-driver">
 <GoldlineOverworld playerIdentity={`${session.tenantId}:${session.id}`} greystarActive={false} suppressCampaignChrome onEnterGreystar={()=>{}} onResolveOrder={async()=>false} dayObjectiveCount={1}
  activeObjective={{id:mission.id,kind:"growth",title:mission.title,sourceLabel:mission.outcome?"FIELD EVIDENCE RECORDED":"YOUR FIRST MISSION",dueAt:null,status:mission.outcome?"completed":"ready",address:mission.checkpoint.label,latitude:mission.checkpoint.latitude,longitude:mission.checkpoint.longitude,physicalEntityId:null,explanation:mission.objective,sourceEvidenceReference:mission.traversalCompletedAt?"Passage crossed · Record your real field observation":"Move through Overland and cross a linehook passage",sourceOccurredAt:session.completedAt}}
  onFirstMissionTraversal={()=>{if(!mission.traversalCompletedAt&&!traversal.isPending)traversal.mutate({missionId:mission.id});}}
  briefingLabel={mission.outcome?(mission.gameplayCompletedAt?"RETURN TO YOUR WORLD":"CONFRONT THE GUARDIAN"):"YOUR FIELD OBJECTIVE"}
  onOpenDayBriefing={()=>{if(mission.gameplayCompletedAt)window.location.href="/growth/lantern-city";else if(mission.outcome)setEncounter(true);else setBriefing(true);}} />
 {briefing&&<section className="gl-field-sheet" role="dialog" aria-modal="true" aria-label="First mission field outcome"><button className="gl-sheet-close" onClick={()=>setBriefing(false)}>BACK TO THE GAME</button><p className="gl-eyebrow">TERRITORY SCOUT</p><h1>{mission.title}</h1><p>{mission.objective}</p><p className="gl-story-echo">The resistance: “{mission.avoidance}”</p>
 <a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${mission.checkpoint.latitude},${mission.checkpoint.longitude}`}>OPEN REAL CHECKPOINT IN MAPS ↗</a>
 {!mission.traversalCompletedAt?<p>Cross a linehook passage in Overland to open your field journal. Movement in the game does not count as a real visit.</p>:<form onSubmit={e=>{e.preventDefault();report.mutate({missionId:mission.id,text,confirmedPresence:true,gps});}}>
 <button type="button" onClick={()=>{setGpsStatus("Locating…");navigator.geolocation?.getCurrentPosition(p=>{setGps({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy});setGpsStatus(`Location context attached (±${Math.round(p.coords.accuracy)} m).`);},()=>setGpsStatus("GPS unavailable. You can still attest your own presence."),{enableHighAccuracy:true,timeout:12000,maximumAge:0});}}>ATTACH CURRENT LOCATION</button><p>{gpsStatus}</p>
 <label htmlFor="field-outcome">What did you actually observe? What is the next useful action?</label><textarea id="field-outcome" required minLength={12} maxLength={2000} value={text} onChange={e=>setText(e.target.value)} />
 <label className="gl-presence"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> I personally visited this area and this describes my actual observation.</label>
 <p>GPS adds context. Your report does not create a customer, conversation, sale, or handoff.</p><button disabled={report.isPending||!confirmed||text.trim().length<12}>{report.isPending?"SAVING EVIDENCE…":"RECORD FIELD OUTCOME"}</button></form>}
 {(report.error||traversal.error)&&<p role="alert">{report.error?.message||traversal.error?.message}</p>}
 </section>}
 {encounter&&mission.outcome&&!mission.gameplayCompletedAt&&<div className="gl-first-guardian"><GuardianEncounter definition={definition} state={state} centroid={{x:50,y:30}} reducedMotion={window.matchMedia("(prefers-reduced-motion: reduce)").matches} obligationPresent={false} onDefeat={()=>defeat.mutate({missionId:mission.id})} onClose={()=>setEncounter(false)}/></div>}
 {mission.outcome&&!encounter&&<aside className="gl-first-payoff"><strong>{mission.gameplayCompletedAt?`${guardian.name} defeated` : "Evidence secured. The Guardian is vulnerable."}</strong><p>{mission.outcome.text}</p>{!mission.gameplayCompletedAt&&<button onClick={()=>setEncounter(true)}>CONFRONT {guardian.name.toUpperCase()}</button>}<a href="/growth/lantern-city">RETURN TO LANTERN CITY →</a></aside>}
 {defeat.error&&<div className="gl-first-payoff" role="alert">Victory could not be saved. <button onClick={()=>defeat.mutate({missionId:mission.id})}>RETRY SAVING VICTORY</button></div>}
 </main>;
}
