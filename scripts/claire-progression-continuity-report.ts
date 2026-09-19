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
import { and, eq, sql } from "drizzle-orm";
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

  // Every operator that appears in ANY legacy or new table.
  const scopes = new Map<string, { tenantId: string; operatorUserId: string }>();
  const remember = (rows: Array<{ tenantId: string; operatorUserId: string | null }>) => {
    for (const row of rows) {
      if (!row.operatorUserId) continue;
      if (tenantFilter && row.tenantId !== tenantFilter) continue;
      scopes.set(`${row.tenantId}::${row.operatorUserId}`, { tenantId: row.tenantId, operatorUserId: row.operatorUserId });
    }
  };
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
  const legacyStates = await safe(() => db.select().from(claireRelationshipState));
  remember(legacyStates);
  remember(await safe(() => db.selectDistinct({ tenantId: claireProgressionGrants.tenantId, operatorUserId: claireProgressionGrants.operatorUserId }).from(claireProgressionGrants)));
  remember(await safe(() => db.selectDistinct({ tenantId: claireProgressionEvidence.tenantId, operatorUserId: claireProgressionEvidence.operatorUserId }).from(claireProgressionEvidence)));
  remember(await safe(() => db.selectDistinct({ tenantId: claireDisclosureEntitlements.tenantId, operatorUserId: claireDisclosureEntitlements.operatorUserId }).from(claireDisclosureEntitlements)));
  remember(await safe(() => db.selectDistinct({ tenantId: clairePersonalLedger.tenantId, operatorUserId: clairePersonalLedger.operatorUserId }).from(clairePersonalLedger)));

  const store = getProgressionStore();
  const records: OperatorContinuityRecord[] = [];
  for (const scope of [...scopes.values()].sort((a, b) => `${a.tenantId}${a.operatorUserId}`.localeCompare(`${b.tenantId}${b.operatorUserId}`))) {
    const state = legacyStates.find(row => row.tenantId === scope.tenantId && row.operatorUserId === scope.operatorUserId);
    let legacy: LegacyOperatorState = null;
    if (state) {
      const logScope = and(eq(claireGenerationLogs.tenantId, scope.tenantId), eq(claireGenerationLogs.operatorUserId, scope.operatorUserId));
      const personal = await safe(() =>
        db.select({ ids: claireGenerationLogs.canonFragmentIdsJson }).from(claireGenerationLogs).where(and(logScope, eq(claireGenerationLogs.mode, "personal")))
      );
      const eligible = new Set<string>();
      for (const row of personal) for (const id of (row.ids as string[] | null) ?? []) eligible.add(id);
      const attestedRows = (await safe(() =>
        db
          .select({ attested: sql<number>`count(*)` })
          .from(claireRelationshipEvents)
          .where(and(eq(claireRelationshipEvents.tenantId, scope.tenantId), eq(claireRelationshipEvents.operatorUserId, scope.operatorUserId), eq(claireRelationshipEvents.eventType, "claire_disclosure")))
      )) as Array<{ attested: number }>;
      const attested = attestedRows[0]?.attested ?? 0;
      legacy = {
        disclosureTier: state.disclosureTier,
        qualifyingInteractionCount: state.qualifyingInteractionCount,
        distinctInteractionDays: state.distinctInteractionDays,
        personalModeGenerations: personal.length,
        eligibleCanonFragmentIds: [...eligible].sort(),
        attestedDisclosureEvents: Number(attested ?? 0),
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
