/**
 * Seeds (idempotently) the DayForge boss-demo tenant.
 *
 * Usage:
 *   DAYFORGE_DEMO_ENABLED=true DATABASE_URL=... pnpm dayforge:demo:setup
 */
import "dotenv/config";
import { ENV } from "../server/_core/env";
import { seedDemoTenant } from "../server/dayforgeDemo/demoTenantSeed";

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
  console.log("Local URLs:");
  console.log(`  Admin app:       http://localhost:5173/`);
  console.log(`  Demo tenant app: http://localhost:5173/?tenant=${result.slug}`);
  process.exit(0);
}

main().catch(error => {
  console.error("[dayforge-demo-setup] Failed:", error);
  process.exit(1);
});
