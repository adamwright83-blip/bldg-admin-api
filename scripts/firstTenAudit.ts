/**
 * What the first ten minutes actually found for one real journey: read-only, from the database, for judging the
 * preview honestly (what was read, what each finding rests on, what came out generic or empty). Never prints a token.
 *
 *   railway run --service bldg-admin-api npx tsx scripts/firstTenAudit.ts                 # the newest own journey
 *   railway run --service bldg-admin-api npx tsx scripts/firstTenAudit.ts --journey <id>
 *   ... --redact      # mask email addresses and shorten quotes, for sharing the output
 *
 * The output contains the person's own business information (names, quotes from their mail). Share it deliberately.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../server/db";
import {
  firstTenConnections,
  firstTenDrafts,
  firstTenEvents,
  firstTenFindings,
  firstTenJourneys,
  firstTenPortraits,
  firstTenReadings,
} from "../server/firstTenMinutes/schema";

const args = process.argv.slice(2);
const redact = args.includes("--redact");
const journeyArg = args[args.indexOf("--journey") + 1];
const wantedJourney = args.includes("--journey") ? journeyArg : null;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const clean = (text: unknown, max = 220): string => {
  let value = typeof text === "string" ? text : JSON.stringify(text ?? "");
  if (redact) value = value.replace(EMAIL, match => `${match[0]}…@${match.split("@")[1]}`);
  const limit = redact ? Math.min(max, 90) : max;
  value = value.replace(/\s+/g, " ").trim();
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
};
const seconds = (from: Date, to: Date | null | undefined) => (to ? `${Math.round((to.getTime() - from.getTime()) / 1000)}s` : "–");

/** What a finding says, in one line, by kind (the field that carries the meaning). */
function gist(payload: Record<string, unknown>): string {
  const pick = (...keys: string[]) => keys.map(key => payload[key]).find(value => typeof value === "string" && value.trim());
  // PersonRef: { name: string | null; address: string }; an unnamed contact is still identified by its address
  const person = (value: unknown) => (value && typeof value === "object" ? ((value as { name?: string | null }).name || (value as { address?: string }).address) : null);
  switch (payload.kind) {
    case "person":
      return `${clean(person(payload.person))}: ${payload.sent} sent / ${payload.received} received, last ${payload.lastAt}`;
    case "request":
      return `${clean(person(payload.from))} wants "${clean(payload.wants, 120)}"${payload.recurring ? " (recurring)" : ""}`;
    case "reply":
      return `to ${clean(person(payload.to))}${payload.declined ? ", declined" : ""}${payload.missing ? `, missing: ${clean(payload.missing, 80)}` : ""}`;
    case "habit":
      return `${String(payload.habit).replace(/_/g, " ")}: ${Math.round(Number(payload.share) * 100)}% of ${payload.sampled} sent messages`;
    case "rhythm":
      return `"${clean(payload.word, 40)}" ×${payload.count}, on ${(payload.days as number[] | undefined)?.map(d => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join("/") ?? "?"}`;
    default:
      return clean(pick("name", "statement", "wants", "title", "label", "summary", "quote") ?? payload);
  }
}

/** Signs a finding may be thin: nothing to stand on, or a very short claim. Signals for a person to judge, not verdicts. */
function warnings(payload: Record<string, unknown>, sources: unknown[]): string[] {
  const out: string[] = [];
  if (!sources.length) out.push("no sources");
  const text = gist(payload);
  // names are short by nature; a short claim is what's worth a look
  if (text.length < 12 && !["owner", "business", "image", "person"].includes(String(payload.kind))) out.push("very short");
  if (/\b(customers?|clients?|business|services?|people)\b/i.test(text) && text.split(/\s+/).length <= 3) out.push("possibly generic");
  return out;
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("No database (DATABASE_URL). Run through `railway run --service bldg-admin-api`.");
  const [journey] = wantedJourney
    ? await db.select().from(firstTenJourneys).where(eq(firstTenJourneys.id, wantedJourney)).limit(1)
    : await db.select().from(firstTenJourneys).where(eq(firstTenJourneys.kind, "own")).orderBy(desc(firstTenJourneys.createdAt)).limit(1);
  if (!journey) {
    console.log(wantedJourney ? `No journey ${wantedJourney}.` : "No own (non-example) journey yet.");
    return;
  }
  const start = journey.createdAt;
  const [connections, [reading], storedFindings, [portrait], [draft], events] = await Promise.all([
    db.select().from(firstTenConnections).where(eq(firstTenConnections.journeyId, journey.id)),
    db.select().from(firstTenReadings).where(eq(firstTenReadings.journeyId, journey.id)).limit(1),
    db.select().from(firstTenFindings).where(and(eq(firstTenFindings.journeyId, journey.id))).orderBy(asc(firstTenFindings.kind), asc(firstTenFindings.rank)),
    db.select().from(firstTenPortraits).where(eq(firstTenPortraits.journeyId, journey.id)).limit(1),
    db.select().from(firstTenDrafts).where(eq(firstTenDrafts.journeyId, journey.id)).limit(1),
    db.select().from(firstTenEvents).where(eq(firstTenEvents.journeyId, journey.id)).orderBy(asc(firstTenEvents.createdAt)),
  ]);

  // What the person was shown: the current reading's findings, plus older ones only if they reacted to them (as
  // findingViews in understanding/store.ts). A finding an earlier reading made and this one didn't is not counted.
  const findings = storedFindings.filter(finding => finding.runId === (reading?.runId ?? null) || finding.status !== "proposed");
  const superseded = storedFindings.length - findings.length;

  console.log(`# First ten minutes audit\n`);
  console.log(`Journey ${journey.id}  kind=${journey.kind}  stage=${journey.stage}  started ${start.toISOString()}  tenant=${journey.tenantId ?? "none"}`);

  console.log(`\n## Connections`);
  if (!connections.length) console.log("  none");
  for (const connection of connections) {
    console.log(`  ${connection.provider}: ${clean(connection.accountLabel)}  status=${connection.status}`);
    console.log(`    scopes: ${connection.grantedScopes.split(/\s+/).map(scope => scope.replace("https://www.googleapis.com/auth/", "")).join(", ")}`);
  }

  console.log(`\n## The reading`);
  if (!reading) console.log("  never started");
  else {
    console.log(`  status=${reading.status}  stage=${reading.stage ?? "–"}  took ${seconds(reading.startedAt, reading.finishedAt)}`);
    console.log(`  finished stages: ${(reading.finishedJson ?? []).join(", ") || "none"}`);
    console.log(`  counts: ${JSON.stringify(reading.countsJson ?? {})}`);
    for (const note of reading.notesJson ?? []) console.log(`  note: ${clean(note)}`);
  }

  console.log(`\n## Findings (${findings.length})`);
  if (superseded) console.log(`  (${superseded} from an earlier reading that this one didn't make again, left out)`);
  const byKind = new Map<string, number>();
  const bySource = new Map<string, number>();
  const flagged: string[] = [];
  for (const finding of findings) {
    const payload = finding.payloadJson as unknown as Record<string, unknown>;
    const sources = (finding.sourcesJson ?? []) as Array<{ provider?: string; label?: string; excerpt?: string }>;
    byKind.set(finding.kind, (byKind.get(finding.kind) ?? 0) + 1);
    for (const source of sources) bySource.set(source.provider ?? "?", (bySource.get(source.provider ?? "?") ?? 0) + 1);
    const flags = warnings(payload, sources);
    if (flags.length) flagged.push(`${finding.kind} "${gist(payload)}": ${flags.join(", ")}`);
    console.log(`  [${finding.kind}${finding.companion ? `/${finding.companion}` : ""}] ${gist(payload)}  (${finding.status}${flags.length ? `; ${flags.join(", ")}` : ""})`);
    if (finding.correctionText) console.log(`      your correction: ${clean(finding.correctionText)}`);
    for (const source of sources.slice(0, 2)) console.log(`      ← ${source.provider}: ${clean(source.label, 80)} — "${clean(source.excerpt, 140)}"`);
    if (sources.length > 2) console.log(`      ← and ${sources.length - 2} more`);
  }
  console.log(`  by kind: ${[...byKind].map(([kind, n]) => `${kind} ${n}`).join(", ") || "none"}`);
  console.log(`  by source: ${[...bySource].map(([provider, n]) => `${provider} ${n}`).join(", ") || "none"}`);
  const decided = findings.filter(f => f.status !== "proposed");
  console.log(`  you reacted to ${decided.length}: ${["confirmed", "changed", "dismissed"].map(s => `${s} ${findings.filter(f => f.status === s).length}`).join(", ")}`);

  console.log(`\n## Claire's portrait`);
  if (!portrait) console.log("  not written");
  else {
    console.log(`  status=${portrait.status}  written by=${portrait.writtenBy ?? "–"}  basis=${portrait.basis}  kept=${portrait.keptAt ? "yes" : "no"}`);
    const written = portrait.portraitJson;
    if (written) {
      console.log(`  greeting: ${clean(written.greeting)}`);
      written.paragraphs.flat().forEach(line => console.log(`  • ${clean(line.text, 240)}  [${line.findingIds.length} finding${line.findingIds.length === 1 ? "" : "s"}]`));
      if (written.closing) console.log(`  closing: ${clean(written.closing.text)}`);
    }
    const edits = Object.entries(portrait.editsJson ?? {});
    if (edits.length) console.log(`  you changed ${edits.length} line(s)`);
  }

  console.log(`\n## The real message`);
  if (!draft) console.log("  none prepared");
  else {
    console.log(`  to ${clean(draft.recipientName)} <${clean(draft.recipientAddress)}>  approach=${draft.approach}  edited=${draft.edited}  status=${draft.status}`);
    console.log(`  subject: ${clean(draft.subject)}`);
    console.log(`  body: ${clean(draft.body, 400)}`);
  }

  console.log(`\n## What happened, in order`);
  for (const event of events) console.log(`  +${seconds(start, event.createdAt).padStart(6)}  ${event.kind}`);

  console.log(`\n## To look at`);
  const missing = ["gmail", "calendar", "drive"].filter(provider => !bySource.has(provider));
  if (missing.length) console.log(`  no findings drawn from: ${missing.join(", ")}`);
  if (reading?.status === "failed") console.log("  the reading failed");
  if (portrait && portrait.status !== "ready") console.log(`  the portrait is ${portrait.status}`);
  for (const line of flagged) console.log(`  ${line}`);
  if (!missing.length && !flagged.length && reading?.status === "complete") console.log("  nothing flagged automatically; judge the findings above by eye");
  console.log(`\nThis reads connected accounts only. Public web and social research isn't part of the first ten minutes yet.`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
