/**
 * One-time restoration of the standing instructions Adam already gave Claire and that were lost
 * (production audit of calls since 2026-10-13). It replays the exact statements through the SAME capture
 * path a live call uses (detect -> write -> fresh read back), so every row is versioned and verified.
 * It is not a migration and runs no SQL by hand. Re-running is safe: each statement has a fixed
 * conversation and turn id, so a second run finds the rows and writes nothing.
 *
 * Run after the deploy that creates the tables (scripts/migrate.mjs runs on boot):
 *
 *   railway run pnpm tsx scripts/claire-standing-instructions-seed.ts --tenant default --operator adam-admin
 *   railway run pnpm tsx scripts/claire-standing-instructions-seed.ts --tenant default --operator adam-admin --apply
 *
 * Without --apply it only prints what it would capture. MYSQL_PUBLIC_URL is used when DATABASE_URL is
 * the private-network URL.
 */
import {
  FIXTURE_CHIEF_OF_STAFF,
  FIXTURE_ENCOURAGEMENT,
  FIXTURE_SUNDAY_REVIEW,
} from "../server/agents/daphne/standingInstructions/productionFixtures";

const args = process.argv.slice(2);
const value = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const apply = args.includes("--apply");
const tenantId = value("--tenant");
const operatorUserId = value("--operator");
if (!tenantId || !operatorUserId) throw new Error("--tenant and --operator are required");
if (process.env.MYSQL_PUBLIC_URL) process.env.DATABASE_URL = process.env.MYSQL_PUBLIC_URL;
if (!process.env.DATABASE_URL && apply) throw new Error("DATABASE_URL (or MYSQL_PUBLIC_URL) required with --apply");

const { captureStandingInstructions, detectStandingInstructions } = await import("../server/agents/daphne/standingInstructions");

const statements = [
  { turnId: "restore-encouragement", session: FIXTURE_ENCOURAGEMENT.session, utterance: FIXTURE_ENCOURAGEMENT.utterance, priorClaireTurn: FIXTURE_ENCOURAGEMENT.priorClaireTurn },
  { turnId: "restore-sunday-review", session: FIXTURE_SUNDAY_REVIEW.session, utterance: FIXTURE_SUNDAY_REVIEW.utterance, priorClaireTurn: FIXTURE_SUNDAY_REVIEW.priorClaireTurn },
  { turnId: "restore-chief-of-staff", session: FIXTURE_CHIEF_OF_STAFF.session, utterance: FIXTURE_CHIEF_OF_STAFF.utterance, priorClaireTurn: null },
];

let failed = false;
for (const statement of statements) {
  const detected = detectStandingInstructions(statement.utterance, { priorClaireTurn: statement.priorClaireTurn });
  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, session: statement.session, detected: detected.map(d => ({ kind: d.kind, text: d.text })) }));
    continue;
  }
  const result = await captureStandingInstructions({
    tenantId,
    operatorUserId,
    utterance: statement.utterance,
    priorClaireTurn: statement.priorClaireTurn,
    conversationId: `audit-2026-10-20:${statement.session}`,
    turnId: statement.turnId,
  });
  console.log(JSON.stringify({ session: statement.session, status: result.status, readbackVerified: result.readbackVerified, kinds: result.records.map(r => r.kind) }));
  if (result.status !== "persisted") failed = true;
}
if (failed) {
  console.error("At least one instruction was not saved and read back. Nothing was acknowledged.");
  process.exit(1);
}
process.exit(0);
