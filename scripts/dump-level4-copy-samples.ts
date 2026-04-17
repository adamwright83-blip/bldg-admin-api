/**
 * Dry-run for Level 4 Phase 3: generates real LLM-backed copy samples for
 * Block A (per building) and Block B (synthetic referral candidate, since
 * the live state currently has no real candidate).
 *
 * Run: pnpm tsx scripts/dump-level4-copy-samples.ts
 */
import "dotenv/config";
import { getLevel4OffensiveState } from "../server/level4Offensive";
import {
  generateOffensiveCopy,
  LEVEL4_COPY_SYSTEM_PROMPT,
} from "../server/level4OffensiveCopy";

async function main() {
  const tenantId = process.argv[2] ?? "default";
  process.stdout.write("=== EXACT SYSTEM PROMPT (used verbatim for every Block A/B call) ===\n");
  process.stdout.write(LEVEL4_COPY_SYSTEM_PROMPT + "\n\n");

  const state = await getLevel4OffensiveState(tenantId);

  process.stdout.write("=== BLOCK A — building penetration outreach ===\n");
  for (const b of state.buildingPenetration) {
    process.stdout.write(`\n--- ${b.buildingName} (${b.buildingSlug}) ---\n`);
    const out = await generateOffensiveCopy({
      block: "building_penetration",
      payload: {
        buildingSlug: b.buildingSlug,
        buildingName: b.buildingName,
        convertedUsers: b.convertedUsers,
        convertedPaidUsers: b.convertedPaidUsers,
        total: b.total,
        unconverted: b.unconverted,
        penetrationPct: b.penetrationPct,
        paidPenetrationPct: b.paidPenetrationPct,
      },
    });
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  }

  process.stdout.write("\n=== BLOCK B — referral request ===\n");
  if ("userId" in state.referralRequest) {
    const r = state.referralRequest;
    const out = await generateOffensiveCopy({
      block: "referral_request",
      payload: {
        firstName: r.firstName,
        lastInitial: r.lastInitial,
        orderCount: r.orderCount,
        ltvCents: r.ltvCents,
      },
    });
    process.stdout.write("(live referral candidate)\n");
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else {
    process.stdout.write("(live state has no referral candidate yet — running synthetic sample)\n");
    const out = await generateOffensiveCopy({
      block: "referral_request",
      payload: {
        firstName: "Adam",
        lastInitial: "C",
        orderCount: 5,
        ltvCents: 24800,
      },
    });
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  }

  process.stdout.write("\n=== BLOCK C — market hole (stub, no LLM call) ===\n");
  const blockC = await generateOffensiveCopy({ block: "market_hole", payload: {} });
  process.stdout.write(JSON.stringify(blockC, null, 2) + "\n");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
