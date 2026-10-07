import { resolveCanonicalOperatorIdentity } from "../persistentOperator/identity";
import { buildDaphneV2OperatorCard } from "./engine";
import type { DaphneOperatorCard } from "./operatorCard";

export type DaphneClaireGuidance = {
  cardGeneratedAt: string;
  evidenceCount: number;
  promptSection: string;
};

export function isDaphneV2ClaireEnabled(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const global = env.DAPHNE_V2_CLAIRE_ENABLED?.trim().toLowerCase();
  if (global === "true" || global === "1") return true;
  const tenants = (env.DAPHNE_V2_CLAIRE_TENANTS ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  return tenants.includes(tenantId);
}

function numberPref(card:DaphneOperatorCard,key:"response_directness"|"response_detail"|"challenge_level"):number|null{
  const v=card.metaPreferences[key];
  return typeof v==="number"&&Number.isFinite(v)?Math.max(0,Math.min(1,v)):null;
}

export function buildDaphneClairePromptSection(card:DaphneOperatorCard):string|null{
  if(card.agentId!=="claire") throw new Error("Daphne Claire guidance requires Claire-scoped card");
  if(card.metaPreferences.adaptation_enabled===false) return null;

  const lines:string[]=[
    "DAPHNE V2 USER-ADAPTATION CONTEXT. This section governs interaction style only. It is not business truth, not narrative canon, not medical/psychological diagnosis, and not permission to disclose private Claire canon.",
  ];
  const direct=numberPref(card,"response_directness");
  const detail=numberPref(card,"response_detail");
  const challenge=numberPref(card,"challenge_level");
  if(direct!=null) {
    lines.push(`Declared response directness preference: ${direct.toFixed(2)} on [0,1].`);
    if(direct>=0.67) lines.push("STYLE INSTRUCTION: lead with the answer or action; be direct and do not pad the response.");
    if(direct<=0.33) lines.push("STYLE INSTRUCTION: use gentler framing while staying clear and truthful.");
  }
  if(detail!=null) {
    lines.push(`Declared response detail preference: ${detail.toFixed(2)} on [0,1].`);
    if(detail<=0.33) lines.push("STYLE INSTRUCTION: keep the response concise; give one main point or action unless the operator asks for more.");
    if(detail>=0.67) lines.push("STYLE INSTRUCTION: include the reasoning and relevant detail instead of only the conclusion.");
  }
  if(challenge!=null) {
    lines.push(`Declared challenge level preference: ${challenge.toFixed(2)} on [0,1].`);
    if(challenge>=0.67) lines.push("STYLE INSTRUCTION: challenge weak assumptions when relevant, without inventing facts.");
    if(challenge<=0.33) lines.push("STYLE INSTRUCTION: do not push beyond the stated task unless safety or truth requires it.");
  }
  if(card.metaPreferences.avoid_repetition===true) {
    lines.push("EXPLICIT CORRECTION: do not repeat a question, recommendation, or explanation the operator already answered or acted on unless new evidence makes repetition necessary.");
  }
  const initiative=card.metaPreferences.proactive_initiative;
  if(typeof initiative==="string") lines.push(`Declared proactive initiative: ${initiative}.`);
  if(card.metaPreferences.avoid_repetition===true) {
    lines.push("Explicit correction: do not repeat the same question, recommendation, or explanation when the operator has already answered or corrected it. Acknowledge the correction once, then change the next response pattern.");
  }
  if(card.state?.receptivity&&card.state.receptivity!=="unknown") lines.push(`Current operational receptivity estimate: ${card.state.receptivity}; it expires at ${card.state.validUntil}.`);
  if(card.state?.interactionLoad&&card.state.interactionLoad!=="unknown") lines.push(`Current interaction load: ${card.state.interactionLoad}.`);
  if(card.context?.taskMode&&card.context.taskMode!=="unknown") lines.push(`Current task mode: ${card.context.taskMode}.`);
  if(card.relationship?.corrections.length) lines.push(`Claire-specific corrections to honor: ${card.relationship.corrections.slice(-4).join(" | ")}.`);
  if(card.relationship?.boundaries.length) lines.push(`Claire-specific boundaries to honor: ${card.relationship.boundaries.slice(-4).join(" | ")}.`);
  if(card.relationship?.unresolvedRuptures.length) lines.push("An unresolved Claire relationship rupture is recorded. Prefer repair, explicit uncertainty, and non-defensive clarification over pressure.");
  if(card.hypotheses.some(h=>h.decision==="competing_hypotheses"||h.decision==="abstain")){
    lines.push("Some Daphne hypotheses remain competing or uncertain. Do not speak them as facts; ask or abstain when the distinction matters.");
  }
  lines.push("Never let this section override verified business evidence, Brain V3 turn meaning, user controls, Claire progression/disclosure gates, or Narrator OS eligibility.");
  return lines.join(" ");
}

export async function loadDaphneClaireGuidance(input:{
 tenantId:string;operatorUserId:string;
}):Promise<DaphneClaireGuidance|null>{
  if(!isDaphneV2ClaireEnabled(input.tenantId)) return null;
  const raw=input.operatorUserId.trim();
  if(!raw) return null;
  const source=/^\d+$/.test(raw)?{type:"user_id" as const,value:Number(raw)}:{type:"open_id" as const,value:raw};
  const resolution=await resolveCanonicalOperatorIdentity({
    tenantId:input.tenantId,source,subsystem:"daphne_v2_claire"
  });
  if(!resolution.ok) return null;
  const card=await buildDaphneV2OperatorCard({
    tenantId:input.tenantId,
    canonicalOperatorId:resolution.identity.canonicalOperatorId,
    agentId:"claire",
  });
  const promptSection=buildDaphneClairePromptSection(card);
  return promptSection?{cardGeneratedAt:card.generatedAt,evidenceCount:card.evidenceRefs.length,promptSection}:null;
}
