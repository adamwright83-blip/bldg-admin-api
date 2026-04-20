/**
 * Server-side integration dry-run for the full Level 4 round-trip.
 * Mirrors what the browser click flow would exercise at the tRPC layer:
 *   1. getLevel4OffensiveState
 *   2. generateOffensiveCopy (Block A top pick + Block B candidate if any)
 *   3. executeOffensiveAction (writes admin_action_log)
 *   4. getLevel4OffensiveState again (verify server-side invalidation effect)
 *   5. Dedup round-trip — second execute should return { deduped: true }
 *
 * Run:
 *   pnpm tsx scripts/dry-run-level4-execute.ts
 */
import "dotenv/config";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { getLevel4OffensiveState } from "../server/level4Offensive";
import { generateOffensiveCopy } from "../server/level4OffensiveCopy";
import { executeOffensiveAction } from "../server/level4OffensiveExecute";
import { adminActionLog } from "../drizzle/schema";

const TENANT = process.argv[2] ?? "default";

async function readLatestLog(tenantId: string, actionType: string) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(adminActionLog)
    .where(and(eq(adminActionLog.tenantId, tenantId), eq(adminActionLog.actionType, actionType)))
    .orderBy(desc(adminActionLog.createdAt))
    .limit(1);
  return row ?? null;
}

async function main() {
  process.stdout.write(`=== Level 4 dry-run · tenant=${TENANT} ===\n`);

  const state0 = await getLevel4OffensiveState(TENANT);
  process.stdout.write(`\n[1] getLevel4OffensiveState (pre)\n`);
  process.stdout.write(
    `    dbAvailable=${state0.dbAvailable}  buildings=${state0.buildingPenetration.length}  ` +
      `referral=${"userId" in state0.referralRequest ? state0.referralRequest.userId : "null"}\n`
  );

  // ---- Block A — building_penetration ----
  const topBuilding = [...state0.buildingPenetration].sort((a, b) => b.unconverted - a.unconverted)[0];
  if (topBuilding) {
    process.stdout.write(`\n[2A] generateOffensiveCopy block=building_penetration → ${topBuilding.buildingName}\n`);
    const gen = await generateOffensiveCopy({
      block: "building_penetration",
      brand: "default",
      payload: {
        buildingSlug: topBuilding.buildingSlug,
        buildingName: topBuilding.buildingName,
        convertedUsers: topBuilding.convertedUsers,
        convertedPaidUsers: topBuilding.convertedPaidUsers,
        total: topBuilding.total,
        unconverted: topBuilding.unconverted,
        penetrationPct: topBuilding.penetrationPct,
        paidPenetrationPct: topBuilding.paidPenetrationPct,
      },
    });
    if (gen.block !== "building_penetration" || !gen.copy) throw new Error("bad A copy");
    process.stdout.write(`     deliverable: ${gen.copy.deliverable}  brand: ${gen.copy.brandId}\n`);
    process.stdout.write(`     primaryCopy: ${gen.copy.primaryCopy}\n`);

    process.stdout.write(`\n[3A] executeOffensiveAction block=building_penetration (first call)\n`);
    const r1 = await executeOffensiveAction(TENANT, {
      block: "building_penetration",
      buildingSlug: topBuilding.buildingSlug,
      buildingName: topBuilding.buildingName,
      metadata: {
        convertedUsers: topBuilding.convertedUsers,
        convertedPaidUsers: topBuilding.convertedPaidUsers,
        total: topBuilding.total,
        unconverted: topBuilding.unconverted,
        penetrationPct: topBuilding.penetrationPct,
        paidPenetrationPct: topBuilding.paidPenetrationPct,
      },
      generatedCopy: gen.copy,
    });
    process.stdout.write(`     result=${JSON.stringify(r1)}\n`);
    const logA = await readLatestLog(TENANT, "building_penetration");
    process.stdout.write(`     latest admin_action_log row: ${JSON.stringify(logA, null, 2)}\n`);

    process.stdout.write(`\n[4A] executeOffensiveAction block=building_penetration (dedup call)\n`);
    const r2 = await executeOffensiveAction(TENANT, {
      block: "building_penetration",
      buildingSlug: topBuilding.buildingSlug,
      buildingName: topBuilding.buildingName,
      metadata: {
        convertedUsers: topBuilding.convertedUsers,
        convertedPaidUsers: topBuilding.convertedPaidUsers,
        total: topBuilding.total,
        unconverted: topBuilding.unconverted,
        penetrationPct: topBuilding.penetrationPct,
        paidPenetrationPct: topBuilding.paidPenetrationPct,
      },
      generatedCopy: gen.copy,
    });
    process.stdout.write(`     result=${JSON.stringify(r2)}\n`);
  } else {
    process.stdout.write(`\n[2A] skipped — no building penetration rows\n`);
  }

  // ---- Block B — referral_request ----
  const r = state0.referralRequest;
  if ("userId" in r) {
    process.stdout.write(`\n[2B] live referral candidate → ${r.firstName} ${r.lastInitial}. (userId=${r.userId})\n`);
    const gen = await generateOffensiveCopy({
      block: "referral_request",
      brand: "default",
      payload: {
        firstName: r.firstName,
        lastInitial: r.lastInitial,
        orderCount: r.orderCount,
        ltvCents: r.ltvCents,
      },
    });
    if (gen.block !== "referral_request" || !gen.copy) throw new Error("bad B copy");
    process.stdout.write(`     deliverable: ${gen.copy.deliverable}  brand: ${gen.copy.brandId}\n`);
    process.stdout.write(`     primaryCopy: ${gen.copy.primaryCopy}\n`);

    process.stdout.write(`\n[3B] executeOffensiveAction block=referral_request (first call)\n`);
    const rr = await executeOffensiveAction(TENANT, {
      block: "referral_request",
      userId: r.userId,
      firstName: r.firstName,
      lastInitial: r.lastInitial,
      orderCount: r.orderCount,
      ltvCents: r.ltvCents,
      generatedCopy: gen.copy,
    });
    process.stdout.write(`     result=${JSON.stringify(rr)}\n`);
    const stateAfter = await getLevel4OffensiveState(TENANT);
    const stillCandidate =
      "userId" in stateAfter.referralRequest && stateAfter.referralRequest.userId === r.userId;
    process.stdout.write(
      `     post-execute referralRequest excludes deployed user? ${stillCandidate ? "NO (bug)" : "YES ✓"}\n`
    );
  } else {
    process.stdout.write(`\n[2B] no live referral candidate — UI will show lane 2 disabled / "NO CANDIDATE"\n`);
  }

  // ---- Block C — market_hole_outreach stub ----
  process.stdout.write(`\n[2C] executeOffensiveAction block=market_hole_outreach (first call)\n`);
  const c1 = await executeOffensiveAction(TENANT, { block: "market_hole_outreach" });
  process.stdout.write(`     result=${JSON.stringify(c1)}\n`);
  const logC = await readLatestLog(TENANT, "market_hole_outreach");
  process.stdout.write(`     latest admin_action_log row: ${JSON.stringify(logC, null, 2)}\n`);

  process.stdout.write(`\n[3C] executeOffensiveAction block=market_hole_outreach (dedup call)\n`);
  const c2 = await executeOffensiveAction(TENANT, { block: "market_hole_outreach" });
  process.stdout.write(`     result=${JSON.stringify(c2)}\n`);

  process.stdout.write(`\n=== done ===\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
