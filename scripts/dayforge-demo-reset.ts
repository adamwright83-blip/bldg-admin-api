/**
 * Resets the DayForge boss-demo tenant's mutable state and re-seeds it.
 * Admin-only in application code; this CLI acts as a trusted system actor
 * and still requires DAYFORGE_DEMO_ENABLED=true.
 *
 * Usage:
 *   DAYFORGE_DEMO_ENABLED=true DATABASE_URL=... pnpm dayforge:demo:reset
 */
import "dotenv/config";
import { ENV } from "../server/_core/env";
import { resetDemoTenant } from "../server/dayforgeDemo/demoTenantReset";
import { seedDemoTenant } from "../server/dayforgeDemo/demoTenantSeed";

async function main() {
  if (!ENV.dayforgeDemoEnabled) {
    console.error(
      "[dayforge-demo-reset] DAYFORGE_DEMO_ENABLED is not true. Refusing to reset."
    );
    process.exit(1);
  }

  const resetResult = await resetDemoTenant({ role: "admin", id: "cli:dayforge-demo-reset" });
  console.log("[dayforge-demo-reset] Demo tenant mutable state cleared");
  console.log(`  tenantId:     ${resetResult.tenantId}`);
  console.log(`  resetAt:      ${resetResult.resetAt}`);
  console.log(`  auditEventId: ${resetResult.auditEventId}`);

  const seedResult = await seedDemoTenant();
  console.log("[dayforge-demo-reset] Demo tenant re-seeded");
  console.log(`  mission: ${seedResult.mission.code} (id ${seedResult.mission.id})`);
  console.log("");
  console.log("Local URLs:");
  console.log(`  Admin app:       http://localhost:5173/`);
  console.log(`  Demo tenant app: http://localhost:5173/?tenant=${seedResult.slug}`);
  process.exit(0);
}

main().catch(error => {
  console.error("[dayforge-demo-reset] Failed:", error);
  process.exit(1);
});
