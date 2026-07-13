/**
 * One-command boss demo: validate env, verify DB + migrations, reset/seed
 * only the demo tenant, start the app, smoke-check it, and print exactly
 * what to open and how to log in.
 *
 * Usage:
 *   pnpm dayforge:demo
 *
 * Required env (see .env / docs/dayforge-boss-demo.md):
 *   DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD, DAYFORGE_DEMO_ENABLED=true
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { ENV } from "../server/_core/env";
import { getDb } from "../server/db";
import { verifyDemoTenant } from "../server/dayforgeDemo/demoTenantVerify";
import { resetDemoTenant } from "../server/dayforgeDemo/demoTenantReset";
import { seedDemoTenant } from "../server/dayforgeDemo/demoTenantSeed";
import { getDayforgeProviderStatus } from "../server/dayforgeDemo/providerStatus";
import { printDemoUrls } from "./dayforgeDemoUrls";

const PORT = process.env.PORT || "3000";
const BASE_URL = `http://localhost:${PORT}`;

function fail(message: string): never {
  console.error(`[dayforge-demo] ${message}`);
  process.exit(1);
}

async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function main() {
  console.log("[dayforge-demo] 1/7 Validating environment...");
  const requiredEnv = ["DATABASE_URL", "JWT_SECRET", "ADMIN_PASSWORD"];
  const missingEnv = requiredEnv.filter(name => !process.env[name]?.trim());
  if (missingEnv.length > 0) {
    fail(`Missing required env vars: ${missingEnv.join(", ")}. See docs/dayforge-boss-demo.md.`);
  }
  if (!ENV.dayforgeDemoEnabled) {
    fail("DAYFORGE_DEMO_ENABLED is not true. Set DAYFORGE_DEMO_ENABLED=true and re-run.");
  }

  console.log("[dayforge-demo] 2/7 Connecting to database...");
  const db = await getDb();
  if (!db) fail("Could not connect to DATABASE_URL.");

  console.log("[dayforge-demo] 3/7 Verifying migrations 0035-0044...");
  const { execFileSync } = await import("node:child_process");
  try {
    execFileSync("npx", ["tsx", "scripts/dayforge-migrations-verify.ts"], {
      stdio: "inherit",
      env: process.env,
    });
  } catch {
    fail("Migrations verify failed. Run `pnpm db:dayforge:release` and retry.");
  }

  console.log("[dayforge-demo] 4/7 Resetting and re-seeding the demo tenant...");
  const preExisting = await verifyDemoTenant();
  if (preExisting.checks.some(c => c.name === "demo_tenant_exists" && c.pass)) {
    await resetDemoTenant({ role: "admin", id: "cli:dayforge-demo" });
  }
  const seedResult = await seedDemoTenant();

  console.log("[dayforge-demo] 5/7 Verifying demo tenant integrity...");
  const verifyReport = await verifyDemoTenant();
  if (!verifyReport.ok) {
    console.error(JSON.stringify(verifyReport.checks, null, 2));
    fail("Demo tenant verify failed after setup.");
  }

  console.log("[dayforge-demo] 6/7 Starting the application server...");
  const alreadyUp = await waitForServer(`${BASE_URL}/api/health`, 1000).catch(() => false);
  let child: ReturnType<typeof spawn> | undefined;
  if (!alreadyUp) {
    child = spawn("pnpm", ["dev"], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
    const up = await waitForServer(BASE_URL, 45_000);
    if (!up) {
      fail(
        `Server did not become ready at ${BASE_URL} within 45s. Run \`pnpm dev\` manually and check the logs.`
      );
    }
  } else {
    console.log(`[dayforge-demo]     Server already running at ${BASE_URL}, reusing it.`);
  }

  console.log("[dayforge-demo] 7/7 Smoke check...");
  const smokeOk = await waitForServer(`${BASE_URL}/dayforge-demo`, 10_000);
  if (!smokeOk) {
    fail(`Smoke check failed: ${BASE_URL}/dayforge-demo did not respond.`);
  }

  const providerStatus = getDayforgeProviderStatus();

  console.log("");
  console.log("=========================================");
  console.log(" DAYFORGE BOSS DEMO READY");
  console.log("=========================================");
  console.log("");
  console.log(`Mission:  ${seedResult.mission.code} — ${seedResult.mission.account.name}`);
  console.log("");
  printDemoUrls(seedResult.mission.id);
  console.log("");
  console.log("Provider status:");
  console.log(`  Google:  ${providerStatus.google}`);
  console.log(`  Stripe:  ${providerStatus.stripe}`);
  console.log(`  Email:   ${providerStatus.email}`);
  console.log(`  SMS:     ${providerStatus.sms}`);
  console.log(`  Print:   ${providerStatus.print}`);
  console.log("");
  console.log("Ready for presentation.");
  process.exit(0);
}

main().catch(error => {
  console.error("[dayforge-demo] Failed:", error);
  process.exit(1);
});
