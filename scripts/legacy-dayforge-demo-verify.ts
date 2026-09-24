/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/**
 * Server-side integrity check for the DayForge boss-demo tenant. Prints
 * pass/fail per check and exits nonzero on any failure.
 *
 * Usage:
 *   DATABASE_URL=... pnpm legacy-dayforge:demo:verify
 */
import "dotenv/config";
import { verifyDemoTenant } from "../server/legacyDayforgeDemo/demoTenantVerify";

async function main() {
  const report = await verifyDemoTenant();
  console.log("[legacy-dayforge-demo-verify] Results:");
  for (const check of report.checks) {
    const mark = check.pass ? "PASS" : "FAIL";
    const detail = check.detail ? ` — ${check.detail}` : "";
    console.log(`  [${mark}] ${check.name}${detail}`);
  }
  console.log("");
  console.log(report.ok ? "[legacy-dayforge-demo-verify] OK" : "[legacy-dayforge-demo-verify] FAILED");
  process.exit(report.ok ? 0 : 1);
}

main().catch(error => {
  console.error("[legacy-dayforge-demo-verify] Failed:", error);
  process.exit(1);
});
