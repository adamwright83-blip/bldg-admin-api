/**
 * W4 acceptance — an October-shaped month replayed through the REAL progression pipeline on disposable MySQL.
 *
 * Real paths: the Day 1 Ten Doors outcome writer (operator tap) and its progression hook, the relationship
 * emitter for completed calls, the governed evidence writer, the backfill (dry-run and apply), the Drizzle
 * progression store (evidence, monotonic grant, entitlements), the personal controller and authored-decline
 * selection, and the admin status read. The ONE substitution is canonical order truth (native + CleanCloud
 * merge with payment-authority receipts), which is injected as two already-canonical paid first orders; that
 * layer has its own suite (correctivePass.test.ts).
 *
 *   docker run -d --name claire-w4-mysql -e MYSQL_ROOT_PASSWORD=test-only -e MYSQL_DATABASE=claire_w4 -p 127.0.0.1:3472:3306 mysql:8.0
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3472/claire_w4 node scripts/migrate.mjs
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3472/claire_w4 pnpm vitest run --config vitest.integration.config.ts server/claire/progression/progressionOctober.mysql.integration.test.ts
 */
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CustomerOrderTruthRecord } from "../../geography/customerOrderTruth";

const DATABASE_URL = process.env.DATABASE_URL;
const describeMysql = DATABASE_URL ? describe : describe.skip;
const TENANT = "default";
const OPERATOR = "adam-admin";
const LEGACY_LOGIN = "driver-primary";
// Retained storage-table literals behind a named legacy seam (docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md).
const LEGACY_DAYFORGE_TENANTS_TABLE = "dayforge_saas_tenants";
const LEGACY_DAYFORGE_MEMBERSHIPS_TABLE = "dayforge_saas_memberships";
const at = (day: number, hour = 18) => new Date(Date.UTC(2026, 9, day, hour));

function paidFirstOrder(id: number, phone: string, day: number): CustomerOrderTruthRecord {
  return {
    source: "laundry_butler", sourceOrderId: String(id), id, createdAt: at(day, 15),
    firstName: "Fixture", lastName: `Customer ${id}`, phone, email: null, address: "1 Fixture St", unit: null,
    buildingSlug: null, bldgUserId: null, cleancloudCustomerId: null, buildingResolutionStatus: "not_applicable",
    allowNameComposite: false, paid: true, totalCents: 3000, cancelled: false, recognizedAt: at(day, 15),
  };
}
const OCTOBER_ORDERS = [paidFirstOrder(9701, "310-555-0701", 10), paidFirstOrder(9707, "310-555-0707", 18)];

describeMysql("Claire progression — October replay on disposable MySQL", () => {
  let sql: mysql.Connection;

  const count = async (query: string, params: unknown[] = []) => {
    const [rows] = await sql.query<mysql.RowDataPacket[]>(query, params);
    return Number(rows[0]!.n);
  };
  const evidenceRows = (operator = OPERATOR) =>
    count("SELECT COUNT(*) AS n FROM claire_progression_evidence WHERE tenantId = ? AND operatorUserId = ?", [TENANT, operator]);
  const waitForEvidence = async (operator: string, expected: number) => {
    for (let i = 0; i < 100; i += 1) {
      if ((await evidenceRows(operator)) >= expected) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`timed out waiting for ${expected} evidence rows for ${operator}`);
  };
  const tap = async (driverId: string, targetIndex: number, day: number) => {
    vi.setSystemTime(at(day));
    const { getOrCreateDay1TenDoorsMission, recordDay1TenDoorsOutcome } = await import("../../openChannel/day1TenDoorsService");
    const mission = await getOrCreateDay1TenDoorsMission({ tenantId: TENANT, driverId });
    return recordDay1TenDoorsOutcome({
      tenantId: TENANT, driverId, missionId: mission.missionId, targetId: mission.targets[targetIndex]!.id, outcome: "pitched",
    });
  };

  beforeAll(async () => {
    const parsed = new URL(DATABASE_URL!);
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
      throw new Error(`This acceptance run writes; it refuses non-local DATABASE_URL host ${parsed.hostname}`);
    }
    process.env.OWNER_OPEN_ID = OPERATOR;
    vi.useFakeTimers({ toFake: ["Date"] });
    sql = await mysql.createConnection(DATABASE_URL!);
    await sql.query(
      `INSERT IGNORE INTO ${LEGACY_DAYFORGE_TENANTS_TABLE} (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')`,
      [TENANT, TENANT, "Laundry Farm", "Laundry Farm", "#123456", "Adam", "acceptance@example.invalid", "America/Los_Angeles"]
    );
    await sql.query(`INSERT IGNORE INTO ${LEGACY_DAYFORGE_MEMBERSHIPS_TABLE} (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)`, [TENANT, OPERATOR]);
    await sql.query("INSERT IGNORE INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'admin','password')", [TENANT, OPERATOR, "Adam", "acceptance@example.invalid"]);
    for (const table of ["claire_disclosure_entitlements", "claire_progression_evidence", "claire_progression_grants", "claire_relationship_events", "claire_relationship_state"]) {
      await sql.query(`DELETE FROM ${table} WHERE tenantId = ?`, [TENANT]);
    }
    await sql.query("DELETE t FROM open_channel_mission_tasks t JOIN open_channel_missions m ON m.id = t.missionId WHERE m.tenantId = ?", [TENANT]);
    await sql.query("DELETE FROM open_channel_missions WHERE tenantId = ?", [TENANT]);
  });

  afterAll(async () => {
    vi.useRealTimers();
    await sql?.end();
  });

  it("credits real October effort, refuses call volume and approvals, and moves band then rung per policy.ts", async () => {
    const { recordQualifyingClaireInteraction } = await import("../character/relationshipEmitters");
    const { readPersonalProgressionContext, recordProgressionEvidence } = await import("./service");
    const { getProgressionStore } = await import("./drizzleStore");
    const { applyProgressionBackfill, formatBackfillReport, planProgressionBackfill } = await import("./backfill");
    const { loadDisclosureSafetyOk, loadProgressionBackfillSources } = await import("./evidenceSources");
    const { planPersonalTurn } = await import("./personalController");
    const { selectDialogueLine } = await import("./dialogueRegistry");
    const { readProgressionStatus } = await import("./status");
    const store = getProgressionStore();
    const scope = { tenantId: TENANT, operatorUserId: OPERATOR };

    // 1. Ten scheduled calls completed on ten distinct days: relationship telemetry, never currency.
    for (let day = 5; day <= 14; day += 1) {
      vi.setSystemTime(at(day, 14));
      await recordQualifyingClaireInteraction({
        tenantId: TENANT, operatorUserId: OPERATOR, conversationId: `oct-call-${day}`,
        reason: "conversation_complete", completion: "evening_debrief_complete",
      });
    }
    expect(await count("SELECT COUNT(*) AS n FROM claire_relationship_events WHERE tenantId = ? AND eventType = 'call_completed'", [TENANT])).toBe(10);
    expect(await evidenceRows()).toBe(0);

    // 2. The approved strategic proposal (10-17) is not representable as evidence.
    vi.setSystemTime(at(17));
    const approval = await recordProgressionEvidence(store, {
      ...scope, category: "growth_action", kind: "plan_created", sourceType: "strategic_proposal", sourceId: "proposal-1017",
      provenance: "approved_on_call", occurredAt: at(17),
    });
    expect(approval.ok).toBe(false);
    expect(await evidenceRows()).toBe(0);

    // 3. Three Greystar pitches through the REAL Day 1 writer. Two under the canonical login, one under the
    //    legacy shared-password login (the production driver-id split): the live hook credits that one to
    //    the login it came from, because nothing binds driver-primary to adam-admin.
    await tap(OPERATOR, 0, 3);
    await waitForEvidence(OPERATOR, 1);
    await tap(OPERATOR, 1, 8);
    await waitForEvidence(OPERATOR, 2);
    await tap(LEGACY_LOGIN, 2, 14);
    await waitForEvidence(LEGACY_LOGIN, 1);
    expect(await evidenceRows(OPERATOR)).toBe(2);

    // 4. Backfill DRY-RUN: folds the legacy login in by explicit alias, adds the two new paying customers,
    //    projects the result, and writes NOTHING.
    vi.setSystemTime(at(21));
    const deps = {
      store,
      loadSources: (target: typeof scope) =>
        loadProgressionBackfillSources(target, { aliases: [LEGACY_LOGIN], store, loadTruth: async () => OCTOBER_ORDERS }),
      loadDisclosureSafetyOk,
    };
    const before = await count("SELECT COUNT(*) AS n FROM claire_progression_evidence WHERE tenantId = ?", [TENANT]);
    const plan = await planProgressionBackfill(scope, deps);
    console.log(formatBackfillReport(plan, "dry-run"));
    expect(await count("SELECT COUNT(*) AS n FROM claire_progression_evidence WHERE tenantId = ?", [TENANT])).toBe(before);
    expect(await count("SELECT COUNT(*) AS n FROM claire_progression_grants WHERE tenantId = ? AND operatorUserId = ? AND rapportBand > 0", [TENANT, OPERATOR])).toBe(0);
    expect(plan.rows.filter(row => row.action === "mint").map(row => `${row.kind}:${row.sourceId}`).sort()).toEqual([
      expect.stringMatching(/^confirmed_field_visit:/),
      "new_paying_customer:laundry_butler:9701",
      "new_paying_customer:laundry_butler:9707",
    ]);
    expect(plan.aliasHeldEvidence).toEqual([{ operatorUserId: LEGACY_LOGIN, rows: 1 }]);
    expect(plan.after.grant).toMatchObject({ rapportBand: 1, personalRung: 0 });

    // 5. APPLY: October as it happened. 3 actions on 3 days -> band 1 (3 on 2). Rung 1 needs 5 on 3: not yet.
    const applied = await applyProgressionBackfill(scope, deps);
    expect(applied.created).toBe(3);
    expect(applied.grant).toMatchObject({ rapportBand: 1, personalRung: 0 });
    expect(applied.mintedEntitlementIds).toEqual([]);
    expect(await count("SELECT COUNT(*) AS n FROM claire_disclosure_entitlements WHERE tenantId = ?", [TENANT])).toBe(0);

    // A personal probe at band 1 is refused with a band-1 authored decline.
    const probe = async (topic: string) => {
      const context = await readPersonalProgressionContext(store, scope, "october-probe");
      return { context, plan: planPersonalTurn({ topic, context }) };
    };
    const atBandOne = await probe("central_wound");
    expect(atBandOne.plan).toMatchObject({ kind: "decline", reason: "rung_too_low" });
    expect(selectDialogueLine({ category: "decline", rapportBand: atBandOne.context.grant.rapportBand, random: () => 0 })?.id).toMatch(/^decline_r1_/);

    // 6. The remaining two doors, recorded on 10-20 through the live tap: the hook alone (no backfill) refreshes
    //    the grant: 5 actions on 4 days + 2 strong results -> rung 1, and exactly ONE initial entitlement.
    await tap(OPERATOR, 3, 20);
    await waitForEvidence(OPERATOR, 6);
    await tap(OPERATOR, 4, 20);
    await waitForEvidence(OPERATOR, 7);
    for (let i = 0; i < 100 && (await count("SELECT COUNT(*) AS n FROM claire_progression_grants WHERE tenantId = ? AND operatorUserId = ? AND personalRung >= 1", [TENANT, OPERATOR])) === 0; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const grant = await store.getGrant(scope);
    expect(grant).toMatchObject({ rapportBand: 1, personalRung: 1 });
    expect(grant?.rungPolicyVersion).toBe("rapport-disclosure-2026-09-19.2");
    expect(await count("SELECT COUNT(*) AS n FROM claire_disclosure_entitlements WHERE tenantId = ? AND operatorUserId = ? AND status = 'unused'", [TENANT, OPERATOR])).toBe(1);

    // The entitlement is real: a rung-1 topic would now be a new disclosure; a rung-3 topic still gets the band-1 decline.
    expect((await probe("childhood")).plan).toMatchObject({ kind: "answer", basis: "new_disclosure", needsEntitlement: true });
    const stillLocked = await probe("central_wound");
    expect(stillLocked.plan).toMatchObject({ kind: "decline", reason: "rung_too_low" });
    expect(selectDialogueLine({ category: "decline", rapportBand: stillLocked.context.grant.rapportBand, random: () => 0 })?.id).toMatch(/^decline_r1_/);

    // 7. Idempotent: a second apply creates nothing, mints nothing, lowers nothing.
    const again = await applyProgressionBackfill(scope, deps);
    expect(again.created).toBe(0);
    expect(again.mintedEntitlementIds).toEqual([]);
    expect(again.grant).toMatchObject({ rapportBand: 1, personalRung: 1 });
    expect(await count("SELECT COUNT(*) AS n FROM claire_disclosure_entitlements WHERE tenantId = ?", [TENANT])).toBe(1);

    // 8. The admin status view shows it (read-only).
    const status = await readProgressionStatus(store, scope, { now: at(21) });
    expect(status.counts).toEqual({ growthActions: 5, growthActionDays: 4, progressEvents: 2, strongResults: 2 });
    expect(status.evidenceByKind).toEqual([
      { category: "growth_action", kind: "confirmed_field_visit", rows: 5 },
      { category: "business_progress", kind: "new_paying_customer", rows: 2 },
    ]);
    expect(status.lastEvidence).toHaveLength(7);
    expect(status.nextBand).toEqual({ target: 2, needs: ["3 more growth actions", "1 more distinct action days"] });
  }, 120_000);
});
