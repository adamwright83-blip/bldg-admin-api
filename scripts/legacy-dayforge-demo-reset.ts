/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/**
 * Resets the DayForge boss-demo tenant's mutable state and re-seeds it.
 * Admin-only in application code; this CLI acts as a trusted system actor
 * and still requires DAYFORGE_DEMO_ENABLED=true.
 *
 * Usage:
 *   DAYFORGE_DEMO_ENABLED=true DATABASE_URL=... pnpm legacy-dayforge:demo:reset
 */
import "dotenv/config";
import { ENV } from "../server/_core/env";
import { resetDemoTenant } from "../server/legacyDayforgeDemo/demoTenantReset";
import { seedDemoTenant } from "../server/legacyDayforgeDemo/demoTenantSeed";
import { printDemoUrls } from "./legacyDayforgeDemoUrls";

async function main() {
  if (!ENV.legacyDayforgeDemoEnabled) {
    console.error(
      "[legacy-dayforge-demo-reset] DAYFORGE_DEMO_ENABLED is not true. Refusing to reset."
    );
    process.exit(1);
  }

  const resetResult = await resetDemoTenant({ role: "admin", id: "cli:legacy-dayforge-demo-reset" });
  console.log("[legacy-dayforge-demo-reset] Demo tenant mutable state cleared");
  console.log(`  tenantId:     ${resetResult.tenantId}`);
  console.log(`  resetAt:      ${resetResult.resetAt}`);
  console.log(`  auditEventId: ${resetResult.auditEventId}`);

  const seedResult = await seedDemoTenant();
  console.log("[legacy-dayforge-demo-reset] Demo tenant re-seeded");
  console.log(`  mission: ${seedResult.mission.code} (id ${seedResult.mission.id})`);
  console.log("");
  printDemoUrls(seedResult.mission.id);
  process.exit(0);
}

main().catch(error => {
  console.error("[legacy-dayforge-demo-reset] Failed:", error);
  process.exit(1);
});
