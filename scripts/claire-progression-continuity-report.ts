/**
 * Continuity inspection — READ ONLY. Run against production BEFORE enabling CLAIRE_PROGRESSION.
 *
 *   railway run pnpm tsx scripts/claire-progression-continuity-report.ts [tenantId] [--json]
 *
 * Per (tenantId, operatorUserId) it reports the state that ACTUALLY exists before activation:
 *  - LEGACY relationship/disclosure state (tier, interactions, eligible-in-past canon, attested disclosures);
 *  - the NEW progression state, which accumulates passively while the flag is OFF: rapport band, personal
 *    rung, entitlement cursor, evidence counts by category/kind, entitlement counts by status,
 *    disclosed fragment ids from the new ledger, and the latest relevant timestamps;
 *  - whether dormant progression would become behaviorally ACTIVE on enable.
 * It then lists the three decisions (preserve / reset / reconcile) and chooses none of them.
 *
 * It executes SELECT statements and the progression store's get/list methods only. It writes nothing.
 * (It deliberately avoids loadPersonalProgressionContext, which lazily releases expired reservations.)
 */
import { and, eq } from "drizzle-orm";
import {
  claireDisclosureEntitlements,
  claireGenerationLogs,
  clairePersonalLedger,
  claireProgressionEvidence,
  claireProgressionGrants,
  claireRelationshipEvents,
  claireRelationshipState,
} from "../drizzle/schema";
import { getDb } from "../server/db";
import { isMysqlMissingTableError } from "../server/mysqlErrors";
import {
  buildOperatorContinuityRecord,
  collectProgressionSnapshot,
  enumerateOperatorScopes,
  formatContinuityReport,
  type LegacyOperatorState,
  type OperatorContinuityRecord,
} from "../server/claire/progression/continuityReport";
import { getProgressionStore } from "../server/claire/progression/drizzleStore";

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const tenantFilter = args.find(arg => !arg.startsWith("--"));
  const db = await getDb();
  if (!db) throw new Error("Database not available (run via `railway run`)");

  const safe = async <T>(work: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await work();
    } catch (error) {
      // Only a table that does not exist yet is "no rows". Any other error must surface: a report that
      // silently under-reports state would defeat its purpose.
      if (isMysqlMissingTableError(error)) return [];
      throw error;
    }
  };

  // Every operator that appears in ANY source this report reads: the three legacy sources (relationship
  // state, generation logs, relationship events) and every new progression table.
  const legacyStates = await safe(() => db.select().from(claireRelationshipState));
  const scopeList = enumerateOperatorScopes(
    [
      legacyStates,
      await safe(() => db.selectDistinct({ tenantId: claireGenerationLogs.tenantId, operatorUserId: claireGenerationLogs.operatorUserId }).from(claireGenerationLogs)),
      await safe(() => db.selectDistinct({ tenantId: claireRelationshipEvents.tenantId, operatorUserId: claireRelationshipEvents.operatorUserId }).from(claireRelationshipEvents)),
      await safe(() => db.selectDistinct({ tenantId: claireProgressionGrants.tenantId, operatorUserId: claireProgressionGrants.operatorUserId }).from(claireProgressionGrants)),
      await safe(() => db.selectDistinct({ tenantId: claireProgressionEvidence.tenantId, operatorUserId: claireProgressionEvidence.operatorUserId }).from(claireProgressionEvidence)),
      await safe(() => db.selectDistinct({ tenantId: claireDisclosureEntitlements.tenantId, operatorUserId: claireDisclosureEntitlements.operatorUserId }).from(claireDisclosureEntitlements)),
      await safe(() => db.selectDistinct({ tenantId: clairePersonalLedger.tenantId, operatorUserId: clairePersonalLedger.operatorUserId }).from(clairePersonalLedger)),
    ],
    tenantFilter
  );

  const store = getProgressionStore();
  const records: OperatorContinuityRecord[] = [];
  for (const scope of scopeList) {
    const state = legacyStates.find(row => row.tenantId === scope.tenantId && row.operatorUserId === scope.operatorUserId);
    // Legacy detail is computed from every legacy source, so an operator present only in logs/events still reports.
    const logScope = and(eq(claireGenerationLogs.tenantId, scope.tenantId), eq(claireGenerationLogs.operatorUserId, scope.operatorUserId));
    const personal = await safe(() =>
      db.select({ ids: claireGenerationLogs.canonFragmentIdsJson }).from(claireGenerationLogs).where(and(logScope, eq(claireGenerationLogs.mode, "personal")))
    );
    const eligible = new Set<string>();
    for (const row of personal) for (const id of (row.ids as string[] | null) ?? []) eligible.add(id);
    const relationshipEvents = await safe(() =>
      db
        .select({ eventType: claireRelationshipEvents.eventType })
        .from(claireRelationshipEvents)
        .where(and(eq(claireRelationshipEvents.tenantId, scope.tenantId), eq(claireRelationshipEvents.operatorUserId, scope.operatorUserId)))
    );
    const allGenerations = await safe(() => db.select({ id: claireGenerationLogs.id }).from(claireGenerationLogs).where(logScope));
    let legacy: LegacyOperatorState = null;
    if (state || personal.length > 0 || relationshipEvents.length > 0 || allGenerations.length > 0) {
      legacy = {
        hasRelationshipState: Boolean(state),
        disclosureTier: state?.disclosureTier ?? 0,
        qualifyingInteractionCount: state?.qualifyingInteractionCount ?? 0,
        distinctInteractionDays: state?.distinctInteractionDays ?? 0,
        personalModeGenerations: personal.length,
        eligibleCanonFragmentIds: [...eligible].sort(),
        attestedDisclosureEvents: relationshipEvents.filter(row => row.eventType === "claire_disclosure").length,
      };
    }
    records.push(buildOperatorContinuityRecord({ scope, legacy, progression: await collectProgressionSnapshot(store, scope) }));
  }

  console.log(asJson ? JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2) : formatContinuityReport(records, new Date()));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
