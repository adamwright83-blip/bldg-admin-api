/**
 * Server-side integrity check for the DayForge boss-demo tenant. Prints
 * pass/fail per check and exits nonzero on any failure.
 *
 * Usage:
 *   DATABASE_URL=... pnpm dayforge:demo:verify
 */
import "dotenv/config";
import { verifyDemoTenant } from "../server/dayforgeDemo/demoTenantVerify";

async function main() {
  const report = await verifyDemoTenant();
  console.log("[dayforge-demo-verify] Results:");
  for (const check of report.checks) {
    const mark = check.pass ? "PASS" : "FAIL";
    const detail = check.detail ? ` — ${check.detail}` : "";
    console.log(`  [${mark}] ${check.name}${detail}`);
  }
  console.log("");
  console.log(report.ok ? "[dayforge-demo-verify] OK" : "[dayforge-demo-verify] FAILED");
  process.exit(report.ok ? 0 : 1);
}

main().catch(error => {
  console.error("[dayforge-demo-verify] Failed:", error);
  process.exit(1);
});
