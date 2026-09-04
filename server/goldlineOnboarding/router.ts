import { previewCustomerCsv } from "./customerImport";
import { runTenantImport } from "../saas/tenantImportService";
import { z } from "zod";
import { router, dayforgeTenantOperatorProcedure as procedure } from "../_core/trpc";
import { answerSession } from "../../shared/goldlineOnboarding";
import { hasExistingWorld, readSession, saveSession, startSession } from "./store";
import { interpretAnswers } from "./interpreter";
export const goldlineOnboardingRouter = router({
 previewImport: procedure.input(z.object({payload:z.string().max(500000)})).mutation(({input})=>previewCustomerCsv(input.payload)),
 importCustomers: procedure.input(z.object({payload:z.string().max(500000),fileName:z.string().min(1).max(200)})).mutation(async ({ctx,input})=>{const session=await startSession(ctx.tenantId);if(session.status!=="READY")throw new Error("Complete the five answers before import.");const result=await runTenantImport({tenantId:ctx.tenantId,providerKey:"goldline_customer_csv",sourceFileName:input.fileName,payload:input.payload});await saveSession({...session,optionalUploadReference:result.runId,version:session.version+1},session.version);return result;}),
 state: procedure.query(async ({ ctx }) => { const session = await readSession(ctx.tenantId); return { compatibility: !session && await hasExistingWorld(ctx.tenantId) ? "LEGACY_EXISTING_WORLD" as const : "NEW_WORLD" as const, session }; }),
 start: procedure.mutation(({ ctx }) => startSession(ctx.tenantId)),
 answer: procedure.input(z.object({ question: z.number().int().min(0).max(4), answer: z.string().trim().min(1).max(2000), version: z.number().int() })).mutation(async ({ ctx, input }) => {
  const session = await startSession(ctx.tenantId);
  if (input.version !== session.version) throw new Error("Reload to resume the latest answer.");
  return saveSession(answerSession(session, input.question, input.answer), session.version);
 }),
 interpret: procedure.mutation(async ({ ctx }) => { const session = await startSession(ctx.tenantId); if (session.interpretation) return session; if (session.status !== "READY") throw new Error("Answer all five questions first."); const interpretation = await interpretAnswers(ctx.tenantId, session.answers); return saveSession({ ...session, interpretation, version: session.version + 1 }, session.version); }),
});
