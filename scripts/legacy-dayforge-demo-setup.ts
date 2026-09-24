/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/**
 * Seeds (idempotently) the DayForge boss-demo tenant.
 *
 * Usage:
 *   DAYFORGE_DEMO_ENABLED=true DATABASE_URL=... pnpm legacy-dayforge:demo:setup
 */
import "dotenv/config";
import { ENV } from "../server/_core/env";
import { seedDemoTenant } from "../server/legacyDayforgeDemo/demoTenantSeed";
import { printDemoUrls } from "./legacyDayforgeDemoUrls";

async function main() {
  if (!ENV.legacyDayforgeDemoEnabled) {
    console.error(
      "[legacy-dayforge-demo-setup] DAYFORGE_DEMO_ENABLED is not true. Refusing to seed."
    );
    process.exit(1);
  }

  const result = await seedDemoTenant();
  console.log("[legacy-dayforge-demo-setup] Demo tenant ready");
  console.log(`  tenantId:   ${result.tenantId}`);
  console.log(`  slug:       ${result.slug}`);
  console.log(`  mission:    ${result.mission.code} (id ${result.mission.id}) — ${result.mission.account.name}`);
  console.log("");
  printDemoUrls(result.mission.id);
  process.exit(0);
}

main().catch(error => {
  console.error("[legacy-dayforge-demo-setup] Failed:", error);
  process.exit(1);
});
