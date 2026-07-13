/**
 * Seeds (idempotently) the DayForge boss-demo tenant.
 *
 * Usage:
 *   DAYFORGE_DEMO_ENABLED=true DATABASE_URL=... pnpm dayforge:demo:setup
 */
import "dotenv/config";
import { ENV } from "../server/_core/env";
import { seedDemoTenant } from "../server/dayforgeDemo/demoTenantSeed";
import { printDemoUrls } from "./dayforgeDemoUrls";

async function main() {
  if (!ENV.dayforgeDemoEnabled) {
    console.error(
      "[dayforge-demo-setup] DAYFORGE_DEMO_ENABLED is not true. Refusing to seed."
    );
    process.exit(1);
  }

  const result = await seedDemoTenant();
  console.log("[dayforge-demo-setup] Demo tenant ready");
  console.log(`  tenantId:   ${result.tenantId}`);
  console.log(`  slug:       ${result.slug}`);
  console.log(`  mission:    ${result.mission.code} (id ${result.mission.id}) — ${result.mission.account.name}`);
  console.log("");
  printDemoUrls(result.mission.id);
  process.exit(0);
}

main().catch(error => {
  console.error("[dayforge-demo-setup] Failed:", error);
  process.exit(1);
});
