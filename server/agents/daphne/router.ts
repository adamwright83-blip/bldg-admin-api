import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { legacyDayforgeTenantMemberProcedure, router } from "../../_core/trpc";
import {
  CanonicalOperatorIdentityError,
  requireCanonicalOperatorIdentityForUser,
} from "../persistentOperator/identity";
import { buildDaphneV2OperatorCard, loadDaphneEvidenceBundle } from "./engine";
import {
  DAPHNE_META_PREFERENCE_KEYS,
  loadDaphneMetaPreferences,
  setDaphneMetaPreference,
  validateDaphneMetaPreferenceValue,
} from "./goalsPreferences";
import { recordDaphneObservation } from "./observationStore";
import { chooseDaphnePolicyAction } from "./policyEngine";
import { previewDaphneOutcomeInformedPolicy } from "./learnedPolicy";
import { listDaphneInterventions } from "./interventionLedger";
import { listDaphneOutcomes } from "./outcomeLedger";
import { correctDaphneClaim, inspectDaphneClaim, rejectDaphneClaim } from "./userControls";
import { deleteDaphneV2UserData, exportDaphneV2UserData } from "./privacy";

function identityFailure(error:unknown):never{
 if(error instanceof CanonicalOperatorIdentityError) throw new TRPCError({code:"PRECONDITION_FAILED",message:error.reason});
 throw error;
}

const controlKey=z.enum(DAPHNE_META_PREFERENCE_KEYS);

export const daphneRouter=router({
 card:legacyDayforgeTenantMemberProcedure
  .input(z.object({agentId:z.string().trim().min(1).max(128).default("claire")}).optional())
  .query(async({ctx,input})=>{
   try{
    const identity=await requireCanonicalOperatorIdentityForUser({tenantId:ctx.tenantId,user:ctx.user,subsystem:"daphne.v2.card"});
    return await buildDaphneV2OperatorCard({tenantId:identity.tenantId,canonicalOperatorId:identity.canonicalOperatorId,agentId:input?.agentId??"claire"});
   }catch(e){identityFailure(e);}
  }),
 evidence:legacyDayforgeTenantMemberProcedure
  .input(z.object({limit:z.number().int().min(1).max(500).default(100)}).optional())
  .query(async({ctx,input})=>{
   try{
    const identity=await requireCanonicalOperatorIdentityForUser({tenantId:ctx.tenantId,user:ctx.user,subsystem:"daphne.v2.evidence"});
    return await loadDaphneEvidenceBundle({tenantId:identity.tenantId,canonicalOperatorId:identity.canonicalOperatorId,limit:input?.limit??100});
   }catch(e){identityFailure(e);}
  }),
 controls:legacyDayforgeTenantMemberProcedure.query(async({ctx})=>{
  try{
   const identity=await requireCanonicalOperatorIdentityForUser({tenantId:ctx.tenantId,user:ctx.user,subsystem:"daphne.v2.controls"});
   return await loadDaphneMetaPreferences({tenantId:identity.tenantId,canonicalOperatorId:identity.canonicalOperatorId});
  }catch(e){identityFailure(e);}
 }),
 setControl:legacyDayforgeTenantMemberProcedure
  .input(z.object({key:controlKey,value:z.unknown()}))
  .mutation(async({ctx,input})=>{
   try{
    validateDaphneMetaPreferenceValue(input.key,input.value);
    const identity=await requireCanonicalOperatorIdentityForUser({tenantId:ctx.tenantId,user:ctx.user,subsystem:"daphne.v2.set_control"});
    const observed=await recordDaphneObservation({
     tenantId:identity.tenantId,canonicalOperatorId:identity.canonicalOperatorId,
     operatorUserId:ctx.user.openId,actorType:"user",actorId:ctx.user.openId,
     observationKind:"preference_declaration",evidenceChannel:"stated",verificationStatus:"attested",
     sourceType:"daphne_control_api",sourceReference:`control:${input.key}`,occurredAt:new Date(),
     payload:{preferenceKey:input.key,value:input.value},idempotencyKey:`control:${input.key}:${Date.now()}`
    });
    return await setDaphneMetaPreference({
     tenantId:identity.tenantId,canonicalOperatorId:identity.canonicalOperatorId,
     preferenceKey:input.key,value:input.value,sourceObservationId:observed.id
    });
   }catch(e){identityFailure(e);}
  }),
 inspectClaim:legacyDayforgeTenantMemberProcedure
  .input(z.object({claimId:z.string().trim().min(1).max(64)}))
  .query(async({ctx,input})=>{
   try{
    const identity=await requireCanonicalOperatorIdentityForUser({tenantId:ctx.tenantId,user:ctx.user,subsystem:"daphne.v2.inspect_claim"});
    return await inspectDaphneClaim({tenantId:identity.tenantId,canonicalOperatorId:identity.canonicalOperatorId,claimId:input.claimId});
   }catch(e){identityFailure(e);}
  }),
 correctClaim:legacyDayforgeTenantMemberProcedure
  .input(z.object({claimId:z.string().trim().min(1).max(64),correctedClaim:z.record(z.string(),z.unknown())}))
  .mutation(async({ctx,input})=>{
   try{
    const identity=await requireCanonicalOperatorIdentityForUser({tenantId:ctx.tenantId,user:ctx.user,subsystem:"daphne.v2.correct_claim"});
    return await correctDaphneClaim({tenantId:identity.tenantId,canonicalOperatorId:identity.canonicalOperatorId,operatorUserId:ctx.user.openId,actorId:ctx.user.openId,claimId:input.claimId,correctedClaim:input.correctedClaim});
   }catch(e){identityFailure(e);}
  }),
 rejectClaim:legacyDayforgeTenantMemberProcedure
  .input(z.object({claimId:z.string().trim().min(1).max(64)}))
  .mutation(async({ctx,input})=>{
   try{
    const identity=await requireCanonicalOperatorIdentityForUser({tenantId:ctx.tenantId,user:ctx.user,subsystem:"daphne.v2.reject_claim"});
    return await rejectDaphneClaim({tenantId:identity.tenantId,canonicalOperatorId:identity.canonicalOperatorId,operatorUserId:ctx.user.openId,actorId:ctx.user.openId,claimId:input.claimId});
   }catch(e){identityFailure(e);}
  }),
 exportData:legacyDayforgeTenantMemberProcedure.query(async({ctx})=>{
  try{
   const identity=await requireCanonicalOperatorIdentityForUser({tenantId:ctx.tenantId,user:ctx.user,subsystem:"daphne.v2.export"});
   return await exportDaphneV2UserData({tenantId:identity.tenantId,canonicalOperatorId:identity.canonicalOperatorId});
  }catch(e){identityFailure(e);}
 }),
 deleteData:legacyDayforgeTenantMemberProcedure
  .input(z.object({confirmation:z.literal("DELETE_DAPHNE_DATA")}))
  .mutation(async({ctx})=>{
   try{
    const identity=await requireCanonicalOperatorIdentityForUser({tenantId:ctx.tenantId,user:ctx.user,subsystem:"daphne.v2.delete"});
    return await deleteDaphneV2UserData({tenantId:identity.tenantId,canonicalOperatorId:identity.canonicalOperatorId});
   }catch(e){identityFailure(e);}
  }),
 learnedPolicyPreview:legacyDayforgeTenantMemberProcedure
  .input(z.object({
    agentId:z.string().trim().min(1).max(128).default("claire"),
    policyVersion:z.string().trim().min(1).max(64),
    contextKey:z.string().trim().min(1).max(191),
    options:z.array(z.object({
      key:z.string().trim().min(1).max(128),
      burden:z.number().min(0).max(1),
      relationshipRisk:z.number().min(0).max(1),
      preferenceFit:z.number().min(0).max(1),
      uncertainty:z.number().min(0).max(1),
      hardBlocked:z.boolean().optional()
    })).min(1).max(20)
  }))
  .query(async({ctx,input})=>{
    try{
      const identity=await requireCanonicalOperatorIdentityForUser({
        tenantId:ctx.tenantId,user:ctx.user,subsystem:"daphne.v2.learned_policy_preview"
      });
      const [interventions,outcomes]=await Promise.all([
        listDaphneInterventions({tenantId:identity.tenantId,canonicalOperatorId:identity.canonicalOperatorId,limit:500}),
        listDaphneOutcomes({tenantId:identity.tenantId,canonicalOperatorId:identity.canonicalOperatorId,limit:500}),
      ]);
      return previewDaphneOutcomeInformedPolicy({...input,
        interventions:interventions.filter(i=>i.agentId===input.agentId),outcomes});
    }catch(e){identityFailure(e);}
  }),
 policyPreview:legacyDayforgeTenantMemberProcedure
  .input(z.object({policyVersion:z.string().trim().min(1).max(64),candidates:z.array(z.object({
   key:z.string().trim().min(1).max(128),proximal:z.number(),distal:z.number(),burden:z.number(),
   relationshipRisk:z.number(),preferenceFit:z.number(),uncertainty:z.number(),hardBlocked:z.boolean().optional()
  })).max(20)}))
  .query(({input})=>chooseDaphnePolicyAction(input)),
});
