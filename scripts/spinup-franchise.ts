#!/usr/bin/env tsx
/**
 * Sovereign Franchise Engine CLI
 *
 * Usage:
 *   npx tsx scripts/spinup-franchise.ts --city "Austin, TX" --vertical commercial_laundry --target-mrr 25000
 */

import { provisionFranchise } from "../server/franchise/franchiseService";

const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].replace(/^--/, "");
      const val = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
      options[key] = val;
    }
  }

  return {
    city: options.city || "Austin",
    state: options.state || (options.city?.includes(",") ? options.city.split(",")[1].trim() : "TX"),
    vertical: (options.vertical as any) || "commercial_laundry",
    targetMrrCents: Number(options["target-mrr"] || 25000) * 100,
    operator: options.operator || "Autonomous Lead Fleet",
    phone: options.phone || "+18005550100",
  };
}

async function run() {
  const input = parseArgs();

  console.log(`\n${BOLD}================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   SOVEREIGN FRANCHISE ENGINE — ONE-CLICK OPERATOR FACTORY${RESET}`);
  console.log(`${BOLD}================================================================${RESET}`);
  console.log(`${DIM}Target Metro:${RESET}     ${BOLD}${input.city}, ${input.state}${RESET}`);
  console.log(`${DIM}Vertical:${RESET}         ${input.vertical}`);
  console.log(`${DIM}Macro Goal MRR:${RESET}   $${(input.targetMrrCents / 100).toLocaleString()}`);
  console.log(`${DIM}Initial Fleet:${RESET}    1 Autonomous Van Unit`);
  console.log(`----------------------------------------------------------------\n`);

  console.log(`${YELLOW}Initiating autonomous provisioning sequence...${RESET}\n`);

  const result = await provisionFranchise({
    city: input.city.split(",")[0].trim(),
    state: input.state,
    vertical: input.vertical,
    targetMrrCents: input.targetMrrCents,
    operatorName: input.operator,
    operatorPhone: input.phone,
  });

  for (const step of result.telemetry) {
    await new Promise((r) => setTimeout(r, 80));
    console.log(`  ${GREEN}✓${RESET} [Phase ${step.step}/6] ${BOLD}${step.title}${RESET}`);
    console.log(`    ${DIM}${step.detail}${RESET}`);
  }

  console.log(`\n${BOLD}================================================================${RESET}`);
  console.log(`${BOLD}${GREEN}   FRANCHISE IGNITED SUCCESSFULLY — FLEET ONLINE${RESET}`);
  console.log(`${BOLD}================================================================${RESET}`);
  console.log(`Franchise ID:     ${BOLD}${result.franchise.id}${RESET}`);
  console.log(`Tenant Partition: ${BOLD}${result.franchise.tenantId}${RESET}`);
  console.log(`Corridor Density: ${BOLD}${result.franchise.corridorDensityScore}/100${RESET}`);
  console.log(`Seeded Anchors:   ${BOLD}${result.franchise.territoryAnchors.length} high-rise assets${RESET}`);
  
  console.log(`\n${BOLD}High-Rise Corridor Targets:${RESET}`);
  for (const anchor of result.franchise.territoryAnchors) {
    const statusColor = anchor.status === "targeted" ? YELLOW : DIM;
    console.log(
      `  • ${statusColor}[${anchor.status.toUpperCase()}]${RESET} ${BOLD}${anchor.name}${RESET} (${anchor.potentialUnits} units) — ${anchor.address}`
    );
  }

  console.log(`\n${CYAN}Claire Voice Persona primed with Eve xAI TTS transport.${RESET}`);
  console.log(`${GREEN}Day Line dispatched to driver mobile cockpit at /driver/cockpit?tenant=${result.franchise.tenantId}${RESET}\n`);
}

run().catch((err) => {
  console.error("Franchise ignition error:", err);
  process.exit(1);
});
