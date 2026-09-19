/**
 * Real-MySQL verification of the progression store, on an ISOLATED throwaway tenant. Never touches a
 * real operator. Every row it writes carries tenantId `zz-verify-<timestamp>`; it deletes exactly those
 * rows when finished (logged before/after). Requires an explicit confirmation flag.
 *
 *   DATABASE_URL=<mysql url> pnpm tsx scripts/claire-progression-mysql-verify.ts --i-understand-this-writes-isolated-rows
 */
import { and, eq, sql } from "drizzle-orm";
import {
  claireDisclosureEntitlements, clairePersonalLedger, claireProgressionEvidence, claireProgressionGrants,
} from "../drizzle/schema";
import { getDb } from "../server/db";
import { getProgressionStore } from "../server/claire/progression/drizzleStore";
import { executePersonalTurn } from "../server/claire/progression/personalReveal";
import { collectProgressionSnapshot } from "../server/claire/progression/continuityReport";
import { commitPendingDisclosuresForConversation, recordProgressionEvidence, refreshProgression } from "../server/claire/progression/service";

const TENANT = `zz-verify-${Date.now()}`;
const OP = "verify-operator";
const scope = { tenantId: TENANT, operatorUserId: OP };
const oct = (n: number) => new Date(Date.UTC(2026, 9, n, 15));
const results: Array<[string, boolean, string?]> = [];
const check = (name: string, ok: boolean, detail?: string) => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

async function counts() {
  const db = (await getDb())!;
  const c = async (table: any) => Number((await db.select({ n: sql<number>`count(*)` }).from(table).where(eq(table.tenantId, TENANT)))[0].n);
  return { evidence: await c(claireProgressionEvidence), grants: await c(claireProgressionGrants), entitlements: await c(claireDisclosureEntitlements), ledger: await c(clairePersonalLedger) };
}

async function main() {
  if (!process.argv.includes("--i-understand-this-writes-isolated-rows")) throw new Error("refusing: pass --i-understand-this-writes-isolated-rows");
  const db = (await getDb())!;
  const store = getProgressionStore();
  console.log(`isolated tenant: ${TENANT}\nbefore:`, JSON.stringify(await counts()));
  try {
    // evidence write/read + idempotency + one-event-one-identity
    for (let i = 1; i <= 6; i += 1) await recordProgressionEvidence(store, { ...scope, category: "growth_action", kind: "confirmed_field_visit", sourceType: "commercial_mission", sourceId: `m${i}`, provenance: "debrief_confirm", occurredAt: oct(i), recognizedAt: oct(i) });
    const first = await recordProgressionEvidence(store, { ...scope, category: "business_progress", kind: "new_paying_customer", sourceType: "customer_order_truth", sourceId: "laundry_butler:1", provenance: "laundry_butler_order", occurredAt: oct(8), recognizedAt: oct(9) });
    const dupe = await recordProgressionEvidence(store, { ...scope, category: "business_progress", kind: "dormant_customer_reorder", sourceType: "customer_order_truth", sourceId: "laundry_butler:1", provenance: "remap", occurredAt: oct(8), recognizedAt: oct(9) });
    check("evidence write + read", (await store.listEvidence(scope)).length === 7);
    check("evidence idempotent: same source event, different kind => no second row", first.ok && dupe.ok && dupe.created === false && (await store.listEvidence(scope)).length === 7);
    check("timestamps round-trip (occurredAt vs recognizedAt)", (await store.listEvidence(scope)).some(e => e.sourceId === "laundry_butler:1" && e.occurredAt === oct(8).toISOString() && e.recognizedAt === oct(9).toISOString()));

    // monotonic grant + minting + cursor + idempotent refresh
    const snap = await refreshProgression(store, scope, { disclosureSafetyOk: true, now: () => oct(10) });
    check("grant computed (rapport 1, rung 1)", snap.grant.rapportBand === 1 && snap.grant.personalRung === 1, JSON.stringify(snap.grant));
    check("entitlement minted once", snap.mintedEntitlementIds.length === 1 && (await store.listEntitlements(scope)).length === 1);
    check("entitlement cursor persisted as (recognizedAt|evidenceId)", /^2026-10-09T15:00:00\.000Z\|\d+$/.test((await store.getGrant(scope))!.entitlementCursor ?? ""));
    const again = await refreshProgression(store, scope, { disclosureSafetyOk: true, now: () => oct(11) });
    check("refresh idempotent: no duplicate entitlement", again.mintedEntitlementIds.length === 0 && (await store.listEntitlements(scope)).length === 1);
    const lowered = await store.upsertGrantMonotonic(scope, { rapportBand: 0, rapportPolicyVersion: null, personalRung: 0, rungPolicyVersion: null, entitlementCursor: null });
    check("grant is monotonic at the database (a lower write cannot demote)", lowered.personalRung === 1 && (await store.getGrant(scope))!.personalRung === 1 && (await store.getGrant(scope))!.entitlementCursor !== null);
    await refreshProgression(store, scope, { disclosureSafetyOk: true, now: () => new Date(Date.UTC(2027, 5, 1)) });
    check("dry spell (months later) does not demote", (await store.getGrant(scope))!.personalRung === 1);

    // reservation -> atomic commit (consume + ledger) -> idempotent
    const turn = await executePersonalTurn({ store, scope, conversationId: "claire-call:verify-1", topic: "father", businessOpen: true, random: () => 0, now: () => oct(12), generate: async () => "He was an academic, on paper." });
    const [reserved] = await store.listReservedForConversation({ tenantId: TENANT, conversationId: "claire-call:verify-1" });
    check("reveal reserves durably with full context", turn.outcome === "answered_new_disclosure" && reserved?.status === "reserved" && reserved.reservation?.fragmentId === "core_father_career" && reserved.reservation.rung === 1);
    check("un-delivered reservation is NOT consumed and NOT in the ledger", (await store.listLedger(scope)).every(r => r.kind !== "disclosed"));
    check("commit with a WRONG token is refused", (await store.commitReservedDisclosure({ entitlementId: reserved!.id, token: "wrong", now: oct(12).toISOString() })) === false && (await store.listEntitlements(scope))[0].status === "reserved");
    const committed = await commitPendingDisclosuresForConversation(store, { tenantId: TENANT, conversationId: "claire-call:verify-1" }, () => oct(13));
    const ent = (await store.listEntitlements(scope))[0];
    const disclosed = (await store.listLedger(scope)).filter(r => r.kind === "disclosed");
    check("atomic commit: consumed + exactly one `disclosed` ledger row", committed === 1 && ent.status === "consumed" && disclosed.length === 1 && disclosed[0].fragmentId === "core_father_career");
    check("repeat boundary signal commits nothing twice", (await commitPendingDisclosuresForConversation(store, { tenantId: TENANT, conversationId: "claire-call:verify-1" }, () => oct(14))) === 0 && (await store.listLedger(scope)).filter(r => r.kind === "disclosed").length === 1);

    // transaction semantics on this MySQL: a failing transaction leaves NOTHING behind
    let threw = false;
    try {
      await db.transaction(async tx => {
        await tx.insert(clairePersonalLedger).values({ tenantId: TENANT, operatorUserId: OP, conversationId: "tx-probe", kind: "disclosed", fragmentId: "probe" });
        await tx.update(claireDisclosureEntitlements).set({ status: "unused" }).where(and(eq(claireDisclosureEntitlements.tenantId, TENANT)));
        throw new Error("force rollback");
      });
    } catch { threw = true; }
    const afterRollback = await store.listLedger(scope);
    check("InnoDB transaction rolls back BOTH a ledger insert and an entitlement update", threw && afterRollback.every(r => r.conversationId !== "tx-probe") && (await store.listEntitlements(scope))[0].status === "consumed");

    // reservation lapse / release, cursor advances only for genuinely new events
    await recordProgressionEvidence(store, { ...scope, category: "business_progress", kind: "new_paying_customer", sourceType: "customer_order_truth", sourceId: "laundry_butler:2", provenance: "laundry_butler_order", occurredAt: oct(20), recognizedAt: oct(21) });
    const later = await refreshProgression(store, scope, { disclosureSafetyOk: true, now: () => new Date(Date.UTC(2027, 5, 2)) });
    check("a newly recognized event mints exactly one more entitlement and advances the cursor", later.mintedEntitlementIds.length === 1 && (await store.getGrant(scope))!.entitlementCursor!.startsWith("2026-10-21T"));
    const [fresh] = (await store.listEntitlements(scope)).filter(e => e.status === "unused");
    check("reserve is conditional on 'unused' (second reserve fails)", (await store.reserveEntitlement({ id: fresh.id, token: "t1", now: oct(22).toISOString(), context: { conversationId: "c2", fragmentId: "core_childhood", topic: "childhood", rung: 1, rapportBand: 1 } })) === true && (await store.reserveEntitlement({ id: fresh.id, token: "t2", now: oct(22).toISOString(), context: { conversationId: "c2", fragmentId: "x", topic: "x", rung: 1, rapportBand: 1 } })) === false);
    check("release returns a reservation to unused", (await store.releaseReservation({ id: fresh.id, token: "t1" })) === true && (await store.listEntitlements(scope)).find(e => e.id === fresh.id)!.status === "unused");

    // continuity report reads the resulting state
    const snapshot = await collectProgressionSnapshot(store, scope);
    check("continuity snapshot reads the resulting state", snapshot.personalRung === 1 && snapshot.entitlements.consumed === 1 && snapshot.entitlements.unused === 1 && snapshot.disclosedFragmentIds.join() === "core_father_career" && snapshot.evidenceTotal === 8, JSON.stringify(snapshot.entitlements));
  } finally {
    // Cleanup: delete exactly this isolated tenant's rows (logged before/after).
    console.log("cleanup before:", JSON.stringify(await counts()));
    for (const table of [clairePersonalLedger, claireDisclosureEntitlements, claireProgressionEvidence, claireProgressionGrants] as const) {
      await db.delete(table).where(eq((table as any).tenantId, TENANT));
    }
    const after = await counts();
    console.log("cleanup after:", JSON.stringify(after));
    check("isolated rows fully cleaned up", Object.values(after).every(n => n === 0));
  }
  const failed = results.filter(r => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch(error => { console.error(error); process.exit(1); });
