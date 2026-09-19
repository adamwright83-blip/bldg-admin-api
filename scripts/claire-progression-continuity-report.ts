/**
 * Continuity inspection — READ ONLY. Run against production BEFORE enabling CLAIRE_PROGRESSION.
 *
 *   railway run pnpm tsx scripts/claire-progression-continuity-report.ts [tenantId]
 *
 * Enabling the flag replaces the old tier-based disclosure with a fresh, empty progression state
 * (rapport band 0, rung 0, nothing recorded as disclosed). This report shows, per operator, what
 * that would change, so a human can decide whether that is acceptable. It writes nothing.
 *
 * What it can and cannot know:
 *  - The previous system kept no disclosed-fragment ledger. The closest evidence is
 *    claire_generation_logs (mode = "personal"): the canon fragments that were ELIGIBLE in personal
 *    generations. That is an UPPER BOUND on what may have been told, not proof.
 *  - Legacy disclosureTier and attested claire_disclosure events are reported as-is.
 * Nothing here is guessed into the new ledger. See docs/goldline/EARNED_RAPPORT_DISCLOSURE.md
 * ("Enabling in production") for the decision table.
 */
import { and, eq, sql } from "drizzle-orm";
import { claireGenerationLogs, claireRelationshipEvents, claireRelationshipState } from "../drizzle/schema";
import { getDb } from "../server/db";

async function main() {
  const tenantFilter = process.argv[2];
  const db = await getDb();
  if (!db) throw new Error("Database not available (run via `railway run`)");

  const states = await db
    .select()
    .from(claireRelationshipState)
    .where(tenantFilter ? eq(claireRelationshipState.tenantId, tenantFilter) : undefined);
  console.log(`# Claire progression continuity report (${new Date().toISOString()})`);
  console.log(`operators with legacy relationship state: ${states.length}\n`);

  for (const state of states) {
    const scope = and(eq(claireGenerationLogs.tenantId, state.tenantId), eq(claireGenerationLogs.operatorUserId, state.operatorUserId));
    const personal = await db
      .select({ ids: claireGenerationLogs.canonFragmentIdsJson, source: claireGenerationLogs.generationSource })
      .from(claireGenerationLogs)
      .where(and(scope, eq(claireGenerationLogs.mode, "personal")));
    const eligible = new Set<string>();
    for (const row of personal) for (const id of (row.ids as string[] | null) ?? []) eligible.add(id);
    const [{ disclosureEvents }] = await db
      .select({ disclosureEvents: sql<number>`count(*)` })
      .from(claireRelationshipEvents)
      .where(
        and(
          eq(claireRelationshipEvents.tenantId, state.tenantId),
          eq(claireRelationshipEvents.operatorUserId, state.operatorUserId),
          eq(claireRelationshipEvents.eventType, "claire_disclosure")
        )
      );

    console.log(`- tenant=${state.tenantId} operator=${state.operatorUserId}`);
    console.log(`    legacy disclosureTier: ${state.disclosureTier}  (qualifying interactions ${state.qualifyingInteractionCount}, distinct days ${state.distinctInteractionDays})`);
    console.log(`    personal-mode generations: ${personal.length}; canon fragments that were eligible in them: ${[...eligible].sort().join(", ") || "none"}`);
    console.log(`    attested claire_disclosure events: ${Number(disclosureEvents)}`);
    console.log(
      `    ON ENABLE: rapport band -> 0, personal rung -> 0, disclosed fragments -> none recorded.` +
        (state.disclosureTier > 0 || eligible.size > 0
          ? "  ** legacy access/possible prior disclosures exist that the new system will not know about **"
          : "")
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
