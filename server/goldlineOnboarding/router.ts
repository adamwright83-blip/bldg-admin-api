/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { importedCustomers, revealWorld, mutateFirstMission } from "./firstMission";
import { previewCustomerCsv, summarizeCustomerCsv } from "./customerImport";
import { requireOnboardingSession } from "../saas/saasStore";
import { runTenantImport } from "../saas/tenantImportService";
import { z } from "zod";
import { router, publicProcedure, legacyDayforgeTenantMemberProcedure as memberProcedure, legacyDayforgeTenantOperatorProcedure as procedure } from "../_core/trpc";
import { answerSession, attachFirstAction, authorOperatorTask, orderedGoldlineOnboardingAnswers, prepareClaireOpening } from "../../shared/goldlineOnboarding";
import { hasExistingWorld, readSession, saveSession, startSession } from "./store";
import { interpretAnswers } from "./interpreter";
export const goldlineOnboardingRouter = router({
 // Pre-account mirror for the signup draft. Requires the draft's own resume
 // credentials, returns a summary only, and stores nothing: the list stays in the
 // visitor's browser until the paid workspace exists and importCustomers runs.
 previewDraftCustomerList: publicProcedure.input(z.object({sessionId:z.string().uuid(),resumeToken:z.string().min(32).max(128),payload:z.string().min(1).max(500000)})).mutation(async ({input})=>{const draft=await requireOnboardingSession(input);if(draft.onboardingMode!=="joystick_generic"||draft.status!=="draft")throw new Error("This signup is no longer accepting a customer list.");return summarizeCustomerCsv(input.payload);}),
 previewImport: procedure.input(z.object({payload:z.string().max(500000)})).mutation(({input})=>previewCustomerCsv(input.payload)),
 importCustomers: procedure.input(z.object({payload:z.string().max(500000),fileName:z.string().min(1).max(200)})).mutation(async ({ctx,input})=>{const session=await startSession(ctx.tenantId);if(session.status!=="READY")throw new Error("Complete the five answers before import.");const result=await runTenantImport({tenantId:ctx.tenantId,providerKey:"goldline_customer_csv",sourceFileName:input.fileName,payload:input.payload});await saveSession({...session,optionalUploadReference:result.runId,version:session.version+1},session.version);return result;}),
 customers: memberProcedure.query(({ctx})=>importedCustomers(ctx.tenantId)),
 reveal: procedure.mutation(({ctx})=>revealWorld(ctx.tenantId)),
 clarifyArea: procedure.input(z.object({area:z.string().trim().min(3).max(500)})).mutation(async({ctx,input})=>{const s=await readSession(ctx.tenantId);if(!s||s.status!=="READY")throw new Error("Only an unfinished world can change service area.");const answers=[...s.answers];answers[1]=input.area;return saveSession({...s,answers,interpretation:null,version:s.version+1},s.version);}),
 traversal: memberProcedure.input(z.object({missionId:z.string()})).mutation(({ctx,input})=>mutateFirstMission(ctx.tenantId,ctx.user.openId,input.missionId,{kind:"traversal"})),
 fieldOutcome: memberProcedure.input(z.object({missionId:z.string(),text:z.string().trim().min(12).max(2000),confirmedPresence:z.literal(true),gps:z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),accuracy:z.number().min(0).max(100000)}).nullable()})).mutation(({ctx,input})=>mutateFirstMission(ctx.tenantId,ctx.user.openId,input.missionId,{kind:"outcome",text:input.text,gps:input.gps})),
 defeat: memberProcedure.input(z.object({missionId:z.string()})).mutation(({ctx,input})=>mutateFirstMission(ctx.tenantId,ctx.user.openId,input.missionId,{kind:"defeat"})),
 state: memberProcedure.query(async ({ ctx }) => { const session = await readSession(ctx.tenantId); return { compatibility: !session && await hasExistingWorld(ctx.tenantId) ? "LEGACY_EXISTING_WORLD" as const : "NEW_WORLD" as const, session }; }),
 start: procedure.mutation(({ ctx }) => startSession(ctx.tenantId)),
 answer: procedure.input(z.object({ question: z.number().int().min(0).max(4), answer: z.string().trim().min(1).max(2000), version: z.number().int() })).mutation(async ({ ctx, input }) => {
  const session = await startSession(ctx.tenantId);
  if (input.version !== session.version) throw new Error("Reload to resume the latest answer.");
  return saveSession(answerSession(session, input.question, input.answer), session.version);
 }),
 interpret: procedure.mutation(async ({ ctx }) => { const session = await startSession(ctx.tenantId); if (session.interpretation) return session; if (session.status !== "READY") throw new Error("Answer all five questions first."); const interpretation = await interpretAnswers(ctx.tenantId, orderedGoldlineOnboardingAnswers(session)); return saveSession({ ...session, interpretation, version: session.version + 1 }, session.version); }),
 recordFirstAction: procedure.input(z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("operator_authored_task"), text: z.string().trim().min(1).max(2000), version: z.number().int() }),
  z.object({ kind: z.literal("claire_preparation"), version: z.number().int() }),
 ])).mutation(async ({ ctx, input }) => {
  const session = await readSession(ctx.tenantId);
  if (!session) throw new Error("Start onboarding before saving a first action.");
  if (session.firstAction) return session;
  if (input.version !== session.version) throw new Error("Reload to resume the latest answer.");
  const action = input.kind === "operator_authored_task" ? authorOperatorTask(input.text) : prepareClaireOpening(session);
  return saveSession(attachFirstAction(session, action), session.version);
 }),
});
