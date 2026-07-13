/**
 * Shared "what to open next" printer for the boss-demo CLI scripts.
 * The app is one unified Express + Vite-middleware server (see
 * server/_core/index.ts, default PORT=3000) — there is no separate
 * frontend origin/port in dev or prod.
 */
const PORT = process.env.PORT || "3000";
const BASE_URL = `http://localhost:${PORT}`;

export function printDemoUrls(missionId: number | string): void {
  console.log("Local URLs:");
  console.log(`  Demo control:    ${BASE_URL}/dayforge-demo`);
  console.log(`  Landing:         ${BASE_URL}/dayforge`);
  console.log(`  Territory:       ${BASE_URL}/territory-preview`);
  console.log(`  DayForge login:  ${BASE_URL}/dayforge-login`);
  console.log(`  Admin missions:  ${BASE_URL}/commercial-missions`);
  console.log(`  BORESLAY:        ${BASE_URL}/boreslay-rally?missionId=${missionId}`);
  console.log(`  Field (mobile):  ${BASE_URL}/driver/sales-mission/${missionId}`);
  console.log(`  Proposal:        ${BASE_URL}/commercial-proposal/${missionId}`);
  console.log(`  Pipeline:        ${BASE_URL}/commercial-pipeline`);
  console.log(`  Churn Radar:     ${BASE_URL}/churn-radar`);
  console.log(`  Billing:         ${BASE_URL}/billing`);
  console.log("");
  console.log("Login (required for BORESLAY/Field/Proposal/Pipeline/Churn Radar —");
  console.log("these are tenant-scoped and only resolve to the demo tenant through");
  console.log("this login, not the legacy admin password):");
  console.log(`  Open ${BASE_URL}/dayforge-login and sign in with:`);
  console.log("    Workspace slug: sunset-laundry-demo");
  console.log("    Email:          demo-owner@sunsetlaundry.example");
  console.log("    Password:       SunsetDemo2026!");
  console.log("  (Field/driver login: demo-field@sunsetlaundry.example, same password.)");
  console.log("");
  console.log("The demo control page and legacy /commercial-missions admin view");
  console.log("also accept the ADMIN_PASSWORD env var via role=admin sign-in, but");
  console.log("that path is tenant-blind — use the DayForge login above for the");
  console.log("actual mission/game/field/proposal/pipeline/churn journey.");
}
