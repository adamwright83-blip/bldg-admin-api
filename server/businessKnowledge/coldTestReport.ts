import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BusinessUnderstanding, UnderstoodEntity } from "../../shared/businessKnowledge";
import type { ChapterView } from "../../shared/firstTenMinutesChapter";
import type { FindingView, UnderstandingView } from "../../shared/firstTenMinutesFindings";
import { estimateModelCostCents } from "../agents/costTracking";
import type { CoverageEntry } from "../firstTenMinutes/research/coverage";
import { redactSensitive } from "../firstTenMinutes/research/privacy";
import type { ModelUsage } from "./investigation/models";
import { nameKey, type AssertionRow, type RunRow, type TimelineRow } from "./store";

/**
 * The private report of one cold test (coldTest.ts): what JOYSTICK concluded, checked against the rules, against what
 * the owner says is true (an expectations file they keep), and against the previous run. It holds names, statuses,
 * dates, source labels, counts, tokens and cost: never message bodies, document text or quotes, and no email
 * addresses or phone numbers. Written next to its JSON twin, readable by its owner only.
 */

export type Bucket = "current" | "prelaunch" | "paused" | "past" | "unknown";
export type StageUsage = { category: string; tokens: number; costCents: number };

const BUCKETS: Array<[Bucket, "current" | "prelaunch" | "dormant" | "historical" | "unknown"]> = [
  ["current", "current"],
  ["prelaunch", "prelaunch"],
  ["paused", "dormant"],
  ["past", "historical"],
  ["unknown", "unknown"],
];
const BUCKET_TITLE: Record<Bucket, string> = { current: "Current", prelaunch: "Being prepared", paused: "Paused (quiet, searched)", past: "Past", unknown: "Unknown" };

/** Report text: redacted like evidence, then email addresses and phone numbers taken out too. */
export function clean(text: string | null | undefined, max = 240): string | null {
  if (!text) return null;
  return redactSensitive(text.replace(/\s+/g, " ").trim())
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, "[phone]")
    .slice(0, max);
}

export type JourneyOutcome = {
  reading: { status: string; counts: UnderstandingView["counts"]; notes: string[] };
  findings: Array<{ kind: string; companion: string | null; status: string; summary: string; sources: number }>;
  questions: Array<{ question: string; answered: boolean; understood: string | null }>;
  portrait: { status: string; greeting: string | null; lines: string[]; closing: string | null } | null;
  portraitNote: string | null;
  chapter: {
    opportunity: { type: string; person: string | null; wants: string | null; subject: string | null; service: string | null; route: string | null; place: string | null; along: string | null } | null;
    played: string[];
    draft: { to: string | null; subject: string | null; body: string | null; status: string; left: boolean } | null;
  };
};

export type ColdTestOutcome = {
  version: 1;
  id: string;
  mode: "intelligence" | "journey";
  source: string;
  startedAt: string;
  finishedAt: string;
  wallMs: number;
  /** a run starts only once every table is shown to hold nothing for its id */
  startedFromNothing: true;
  cleanup: { deleted: Record<string, number>; left: 0 } | { kept: true };
  investigator: { configured: string; model: string; status: string; rounds: number; toolCalls: number; stoppedBecause: string; notes: string[] } | null;
  usage: {
    investigator: ModelUsage & { costCents: number; priceBasis: string };
    /** Claude calls under the test id, from JOYSTICK's spend ledger (journey runs); null when it couldn't be read */
    stages: StageUsage[] | null;
    totalCostCents: number;
  };
  timings: Record<string, number>;
  understanding: {
    owner: string | null;
    entities: Array<{ name: string; kind: string; bucket: Bucket; basis: string | null; why: string | null; lastActivity: string | null; sources: string[] }>;
    people: Array<{ name: string; role: string | null; sources: string[] }>;
    relationships: Array<{ subject: string; type: string; object: string; basis: string; confidence: number }>;
    questions: string[];
    conflicts: number;
    gaps: Array<{ source: string; state: string; reasons: string[] }>;
  };
  coverage: Array<{ source: string; operations: number; items: number } & Record<CoverageEntry["status"], number>>;
  checks: Array<{ name: string; ok: boolean }>;
  journey: JourneyOutcome | null;
};

export type ColdTestRaw = {
  id: string;
  mode: ColdTestOutcome["mode"];
  source: string;
  startedAt: Date;
  finishedAt: Date;
  cleanup: { deleted: Record<string, number> } | { kept: true };
  investigator: ColdTestOutcome["investigator"];
  investigatorUsage: ModelUsage;
  stages: StageUsage[] | null;
  timings: Record<string, number>;
  coverage: readonly CoverageEntry[];
  understanding: BusinessUnderstanding;
  live: AssertionRow[];
  events: TimelineRow[];
  run: RunRow | undefined;
  journey?: {
    readingStatus: string;
    reading: UnderstandingView;
    questions: JourneyOutcome["questions"];
    portrait: JourneyOutcome["portrait"];
    portraitNote: string | null;
    chapter: ChapterView;
    played: string[];
  };
};

// ------------------------------------------------------------------ the rules every run is held to

export function ruleChecks(u: BusinessUnderstanding, live: AssertionRow[], events: TimelineRow[]): Array<{ name: string; ok: boolean }> {
  const quiet = new Set([...u.dormant, ...u.historical].map(item => item.id));
  return [
    { name: "nothing paused or past is listed as current", ok: u.current.every(item => !quiet.has(item.id)) },
    { name: "no two names made one legal company by inference", ok: !live.some(row => row.value === "same_legal_entity" && row.basis !== "user_confirmed" && row.basis !== "user_corrected") },
    { name: "nothing authorises a financial merge", ok: live.every(row => !row.authorizesFinancialMerge) },
    { name: "no sale or launch on anything being prepared", ok: !events.some(event => (event.kind === "sale" || event.kind === "launch") && u.prelaunch.some(item => item.id === event.entityId)) },
    { name: "no bank, card or identity number stored", ok: !JSON.stringify(u).match(/\b\d{9,19}\b|\b\d{3}-\d{2}-\d{4}\b/) },
  ];
}

// ------------------------------------------------------------------ building the outcome (everything redacted here)

const labels = (entity: UnderstoodEntity) => [...new Set(entity.sources.map(source => clean(source.label, 120)).filter((label): label is string => Boolean(label)))].sort().slice(0, 6);
/** Names in a stable order, so two runs that concluded the same thing read the same (rows made in the same second can come back either way). */
const byName = <T extends { name: string }>(items: T[]) => [...items].sort((a, b) => a.name.localeCompare(b.name));

function priceBasis(model: string): string {
  const id = model.toLowerCase();
  if (!id || id.startsWith("heuristic")) return "no model was called";
  if (id.includes("gemini")) return "JOYSTICK's price table has no Gemini rate: estimated at its default rate (pass --input-cents-per-million and --output-cents-per-million for Gemini's)";
  const family = id.includes("haiku") ? "Haiku" : id.includes("opus") ? "Opus" : "Sonnet";
  return `JOYSTICK's price table (${family} rate; server/agents/costTracking.ts)`;
}

function summarizeFinding(finding: FindingView): string {
  const p = finding.payload;
  switch (p.kind) {
    case "business":
    case "owner":
      return clean(p.name) ?? "";
    case "person":
      return `${clean(p.person.name) ?? "(no name)"}: ${p.sent} sent, ${p.received} received`;
    case "rule":
    case "promise":
      return clean(p.statement) ?? "";
    case "request":
      return `${clean(p.from.name) ?? "(no name)"} asked for ${clean(p.wants) ?? "something"}${p.recurring ? " (recurring)" : ""}${p.subject ? `, "${clean(p.subject, 80)}"` : ""}`;
    case "reply":
      return `reply to ${clean(p.to.name) ?? "(no name)"}${p.declined ? ", declined" : ""}${p.missing ? `; missing then: ${clean(p.missing)}` : ""}`;
    case "service":
      return clean(p.name) ?? "";
    case "place":
      return [clean(p.name), p.category, clean(p.neighborhood)].filter(Boolean).join(", ");
    case "habit":
      return `${p.habit.replace(/_/g, " ")} (${Math.round(p.share * 100)}% of ${p.sampled})`;
    case "image":
      return `${clean(p.name) ?? "an image"}, ${p.uses} uses in ${p.inWhat}`;
    case "route":
      return `${clean(p.title)} on weekday ${p.weekday}, ${p.stops.length} stops, ${p.occurrences} times`;
    case "rhythm":
      return `"${clean(p.word)}" on days ${p.days.join(",")}, ${p.count} times`;
    case "contrast":
      return `${clean(p.aLine)} / ${clean(p.bLine)}`;
    case "opportunity":
      return `${p.type}: ${clean(p.summary)}`;
  }
}

function journeyOutcome(raw: NonNullable<ColdTestRaw["journey"]>): JourneyOutcome {
  const opportunity = raw.chapter.opportunity;
  const draft = raw.chapter.draft;
  return {
    reading: { status: raw.readingStatus, counts: raw.reading.counts, notes: raw.reading.notes.map(note => clean(note) ?? "") },
    findings: raw.reading.findings.map(finding => ({ kind: finding.payload.kind, companion: finding.companion, status: finding.status, summary: summarizeFinding(finding), sources: finding.sources.length })),
    questions: raw.questions.map(item => ({ question: clean(item.question, 400) ?? "", answered: item.answered, understood: clean(item.understood, 400) })),
    portrait: raw.portrait
      ? { status: raw.portrait.status, greeting: clean(raw.portrait.greeting), lines: raw.portrait.lines.map(line => clean(line, 400) ?? ""), closing: clean(raw.portrait.closing, 400) }
      : null,
    portraitNote: clean(raw.portraitNote),
    chapter: {
      opportunity: opportunity
        ? {
            type: opportunity.type,
            person: clean(opportunity.person.name),
            wants: clean(opportunity.request.wants),
            subject: clean(opportunity.request.subject, 120),
            service: clean(opportunity.service?.name),
            route: opportunity.route ? `${clean(opportunity.route.title)} (weekday ${opportunity.route.weekday})` : null,
            place: opportunity.place ? [clean(opportunity.place.name), opportunity.place.category].filter(Boolean).join(", ") : null,
            along: opportunity.along,
          }
        : null,
      played: raw.played,
      draft: draft
        ? { to: clean(draft.to.name), subject: clean(draft.subject, 200), body: clean(draft.body, 2000), status: draft.status, left: draft.sentByJoystick || Boolean(draft.handedOffAt || draft.reportedSentAt || draft.verifiedSentAt) }
        : null,
    },
  };
}

function coverageSummary(entries: readonly CoverageEntry[]): ColdTestOutcome["coverage"] {
  const bySource = new Map<string, ColdTestOutcome["coverage"][number]>();
  for (const entry of entries) {
    const row = bySource.get(entry.source) ?? { source: entry.source, operations: 0, items: 0, ok: 0, empty: 0, not_granted: 0, failed: 0, partial: 0, excluded: 0, skipped_budget: 0 };
    row.operations += 1;
    row.items += entry.items;
    row[entry.status] += 1;
    bySource.set(entry.source, row);
  }
  return [...bySource.values()].sort((a, b) => a.source.localeCompare(b.source));
}

/** The spend ledger's own investigator line, which the investigator's cost (at whatever rate) stands in for. */
const INVESTIGATOR_CATEGORY = "llm:onboarding_investigator";

/** Every other stage from the ledger, plus the investigator once, at its stated rate: never counted twice. */
function totalCents(stages: StageUsage[] | null, investigatorCents: number): number {
  return (stages ?? []).filter(stage => stage.category !== INVESTIGATOR_CATEGORY).reduce((sum, stage) => sum + stage.costCents, 0) + investigatorCents;
}

export function coldTestOutcome(raw: ColdTestRaw): ColdTestOutcome {
  const u = raw.understanding;
  const model = raw.investigator?.model ?? "";
  const investigatorCost = estimateModelCostCents(raw.investigatorUsage.inputTokens, raw.investigatorUsage.outputTokens, model);
  const checks = ruleChecks(u, raw.live, raw.events);
  if (raw.journey) {
    const draft = raw.journey.chapter.draft;
    checks.push({ name: "no draft left the table", ok: !draft || !(draft.sentByJoystick || draft.handedOffAt || draft.reportedSentAt || draft.verifiedSentAt) });
  }
  return {
    version: 1,
    id: raw.id,
    mode: raw.mode,
    source: raw.source,
    startedAt: raw.startedAt.toISOString(),
    finishedAt: raw.finishedAt.toISOString(),
    wallMs: raw.finishedAt.getTime() - raw.startedAt.getTime(),
    startedFromNothing: true,
    cleanup: "kept" in raw.cleanup ? { kept: true } : { deleted: raw.cleanup.deleted, left: 0 },
    investigator: raw.investigator ? { ...raw.investigator, stoppedBecause: clean(raw.investigator.stoppedBecause) ?? "", notes: raw.investigator.notes.map(note => clean(note) ?? "") } : null,
    usage: {
      investigator: { ...raw.investigatorUsage, costCents: investigatorCost, priceBasis: priceBasis(model) },
      stages: raw.stages,
      totalCostCents: totalCents(raw.stages, investigatorCost),
    },
    timings: raw.timings,
    understanding: {
      owner: clean(u.owner.name),
      entities: BUCKETS.flatMap(([bucket, key]) =>
        byName(
          u[key].map(entity => ({
            name: clean(entity.name, 120) ?? "",
            kind: entity.kind,
            bucket,
            basis: entity.statusBasis,
            why: clean(entity.statusWhy),
            lastActivity: entity.lastActivityAt?.slice(0, 10) ?? null,
            sources: labels(entity),
          }))
        )
      ),
      people: byName(u.people.map(person => ({ name: clean(person.name, 120) ?? "", role: clean(person.role), sources: labels(person) }))),
      relationships: u.relationships
        .map(rel => ({ subject: clean(rel.subject, 120) ?? "", type: rel.type, object: clean(rel.object, 120) ?? "", basis: rel.basis, confidence: rel.confidence }))
        .sort((a, b) => `${a.subject}\u0000${a.type}\u0000${a.object}`.localeCompare(`${b.subject}\u0000${b.type}\u0000${b.object}`)),
      questions: u.openQuestions.map(question => clean(question.followUp ?? question.question, 400) ?? ""),
      conflicts: u.conflicts.length,
      gaps: u.coverageGaps.map(gap => ({ source: gap.source, state: gap.state, reasons: gap.reasons.map(reason => clean(reason, 160) ?? "") })),
    },
    coverage: coverageSummary(raw.coverage),
    checks,
    journey: raw.journey ? journeyOutcome(raw.journey) : null,
  };
}

/** The investigator's cost at a rate the operator gave (cents per million tokens), e.g. for a Gemini model. */
export function repriced(outcome: ColdTestOutcome, price: { input: number; output: number }): ColdTestOutcome {
  const usage = outcome.usage.investigator;
  const costCents = Math.ceil((usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000);
  return {
    ...outcome,
    usage: {
      ...outcome.usage,
      investigator: { ...usage, costCents, priceBasis: `the operator's rate: ${price.input}¢ in / ${price.output}¢ out per million tokens` },
      totalCostCents: totalCents(outcome.usage.stages, costCents),
    },
  };
}

// ------------------------------------------------------------------ what the owner says is true

/**
 * The owner's own expectations, kept privately (never in the repo). Each name may list aliases with "|":
 *   { "current": ["Acme Cleaning|Acme"], "prelaunch": [], "paused": [], "past": [], "people": ["Jules Rivera|Jules"],
 *     "notCurrent": [], "absent": [], "relationships": [{ "subject": "Acme", "type": "brand_of", "object": "Acme Holdings" }] }
 */
export type Expectations = {
  current?: string[];
  prelaunch?: string[];
  paused?: string[];
  past?: string[];
  people?: string[];
  /** must never be listed as current */
  notCurrent?: string[];
  /** must not appear at all */
  absent?: string[];
  relationships?: Array<{ subject: string; type: string; object: string }>;
};

export function parseExpectations(value: unknown): Expectations {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expectations must be a JSON object");
  const source = value as Record<string, unknown>;
  const names = (key: string) => {
    const list = source[key];
    if (list === undefined) return undefined;
    if (!Array.isArray(list) || list.some(item => typeof item !== "string")) throw new Error(`Expectations: "${key}" must be a list of names`);
    return list as string[];
  };
  const relationships = source.relationships;
  if (relationships !== undefined && (!Array.isArray(relationships) || relationships.some(rel => !rel || typeof rel.subject !== "string" || typeof rel.type !== "string" || typeof rel.object !== "string"))) {
    throw new Error('Expectations: "relationships" must be a list of { subject, type, object }');
  }
  return {
    current: names("current"),
    prelaunch: names("prelaunch"),
    paused: names("paused"),
    past: names("past"),
    people: names("people"),
    notCurrent: names("notCurrent"),
    absent: names("absent"),
    relationships: relationships as Expectations["relationships"],
  };
}

/** Relationships that read the same either way round; every other type has a direction. */
const SYMMETRIC = new Set(["related_operation", "separate_business", "same_legal_entity", "collaborates_with"]);

const aliases = (entry: string) => entry.split("|").map(alias => alias.trim()).filter(Boolean);

/** Same name, whatever the case, punctuation or corporate suffix; or a found name that holds every word of it. */
export function nameMatches(found: string, expected: string): boolean {
  const f = nameKey(found);
  if (!f) return false;
  const words = new Set(f.split(" "));
  return aliases(expected).some(alias => {
    const a = nameKey(alias);
    return Boolean(a) && (a === f || a.split(" ").every(word => words.has(word)));
  });
}

export type Comparison = { discoveries: string[]; omissions: string[]; incorrect: string[]; unexpected: string[] };

export function compareWithExpectations(outcome: ColdTestOutcome, expected: Expectations): Comparison {
  const out: Comparison = { discoveries: [], omissions: [], incorrect: [], unexpected: [] };
  const { entities, people, relationships } = outcome.understanding;
  const claimed = new Set<string>();
  const mark = (name: string) => claimed.add(nameKey(name));

  for (const bucket of ["current", "prelaunch", "paused", "past"] as const) {
    for (const entry of expected[bucket] ?? []) {
      const found = entities.filter(entity => nameMatches(entity.name, entry));
      found.forEach(entity => mark(entity.name));
      const where = [...new Set(found.map(entity => entity.bucket))];
      if (where.includes(bucket)) out.discoveries.push(`${aliases(entry)[0]}: ${BUCKET_TITLE[bucket].toLowerCase()}, as you expect`);
      else if (where.length) out.incorrect.push(`${aliases(entry)[0]}: you expect ${BUCKET_TITLE[bucket].toLowerCase()}; JOYSTICK concluded ${where.map(item => BUCKET_TITLE[item].toLowerCase()).join(" and ")}`);
      else out.omissions.push(`${aliases(entry)[0]} (${BUCKET_TITLE[bucket].toLowerCase()}): not found`);
    }
  }
  for (const entry of expected.people ?? []) {
    const found = people.filter(person => nameMatches(person.name, entry));
    found.forEach(person => mark(person.name));
    if (found.length) out.discoveries.push(`${aliases(entry)[0]}: found${found[0].role ? ` (${found[0].role})` : ""}`);
    else out.omissions.push(`${aliases(entry)[0]} (person): not found`);
  }
  for (const entry of expected.notCurrent ?? []) {
    const found = entities.filter(entity => nameMatches(entity.name, entry));
    found.forEach(entity => mark(entity.name));
    if (found.some(entity => entity.bucket === "current")) out.incorrect.push(`${aliases(entry)[0]} is listed as current; you say it isn't`);
  }
  for (const entry of expected.absent ?? []) {
    const names = [...entities.map(entity => entity.name), ...people.map(person => person.name), ...relationships.flatMap(rel => [rel.subject, rel.object])];
    if (names.some(name => nameMatches(name, entry))) out.incorrect.push(`${aliases(entry)[0]} appears; you say it shouldn't`);
  }
  for (const rel of expected.relationships ?? []) {
    // "A product_of B" is not "B product_of A": only a symmetric relationship may be matched either way round
    const pair = relationships.filter(
      found =>
        (nameMatches(found.subject, rel.subject) && nameMatches(found.object, rel.object)) ||
        (SYMMETRIC.has(found.type) && SYMMETRIC.has(rel.type) && nameMatches(found.subject, rel.object) && nameMatches(found.object, rel.subject))
    );
    const label = `${aliases(rel.subject)[0]} ${rel.type} ${aliases(rel.object)[0]}`;
    if (pair.some(found => found.type === rel.type)) out.discoveries.push(`${label}: as you expect`);
    else if (pair.length) out.incorrect.push(`${label}: JOYSTICK concluded ${pair.map(found => found.type).join(" and ")}`);
    else out.omissions.push(`${label}: not concluded`);
  }
  for (const entity of entities) if (!claimed.has(nameKey(entity.name))) out.unexpected.push(`${entity.name} (${BUCKET_TITLE[entity.bucket].toLowerCase()})`);
  for (const person of people) if (!claimed.has(nameKey(person.name))) out.unexpected.push(`${person.name} (person)`);
  for (const check of outcome.checks) if (!check.ok) out.incorrect.push(`rule broken: ${check.name}`);
  return out;
}

// ------------------------------------------------------------------ the previous run

export type RunDiff = { newlyFound: string[]; noLongerFound: string[]; moved: string[]; questionsAdded: string[]; questionsDropped: string[]; costCentsDelta: number; wallMsDelta: number };

export function compareWithPrevious(now: ColdTestOutcome, before: ColdTestOutcome): RunDiff {
  const index = (outcome: ColdTestOutcome) =>
    new Map<string, { name: string; where: string }>([
      ...outcome.understanding.entities.map(entity => [nameKey(entity.name), { name: entity.name, where: entity.bucket }] as const),
      ...outcome.understanding.people.map(person => [`person:${nameKey(person.name)}`, { name: person.name, where: "person" }] as const),
    ]);
  const a = index(before);
  const b = index(now);
  const asked = (outcome: ColdTestOutcome) => new Set(outcome.understanding.questions);
  const qa = asked(before);
  const qb = asked(now);
  return {
    newlyFound: [...b].filter(([key]) => !a.has(key)).map(([, item]) => `${item.name} (${item.where})`),
    noLongerFound: [...a].filter(([key]) => !b.has(key)).map(([, item]) => `${item.name} (${item.where})`),
    moved: [...b].filter(([key, item]) => a.has(key) && a.get(key)!.where !== item.where).map(([key, item]) => `${item.name}: ${a.get(key)!.where} → ${item.where}`),
    questionsAdded: [...qb].filter(question => !qa.has(question)),
    questionsDropped: [...qa].filter(question => !qb.has(question)),
    costCentsDelta: now.usage.totalCostCents - before.usage.totalCostCents,
    wallMsDelta: now.wallMs - before.wallMs,
  };
}

// ------------------------------------------------------------------ the page

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const list = (items: string[], empty = "(none)") => (items.length ? items.map(item => `- ${item}`) : [`- ${empty}`]);

export function renderColdTestReport(outcome: ColdTestOutcome, comparison: Comparison | null, previous: RunDiff | null): string {
  const u = outcome.understanding;
  const usage = outcome.usage;
  const inv = outcome.investigator;
  const lines: string[] = [
    `# Onboarding intelligence cold test: ${outcome.mode === "journey" ? "the full first ten minutes" : "the investigation"}`,
    "",
    `Run ${outcome.startedAt} to ${outcome.finishedAt} (${seconds(outcome.wallMs)}), source journey ${outcome.source}, test id ${outcome.id}.`,
    "",
    `Started from nothing: every table JOYSTICK writes held no rows for this test id before it began.`,
    "kept" in outcome.cleanup
      ? "Kept for inspection: delete it with `--sweep --yes` when done."
      : `Cleaned up: ${Object.values(outcome.cleanup.deleted).reduce((sum, n) => sum + n, 0)} rows deleted (${Object.entries(outcome.cleanup.deleted).filter(([, n]) => n).map(([table, n]) => `${table} ${n}`).join(", ") || "none"}); none left.`,
    "",
    "## Model, tokens, time and cost",
    inv
      ? `- Investigator: asked for ${inv.configured}, ran ${inv.model}; ${inv.status} after ${inv.rounds} rounds and ${inv.toolCalls} tool calls (stopped: ${inv.stoppedBecause || "finished"}).`
      : "- Investigator: didn't run.",
    `- Investigator model: ${usage.investigator.calls} calls (${usage.investigator.failures} failed), ${usage.investigator.inputTokens} tokens in / ${usage.investigator.outputTokens} out, ${seconds(usage.investigator.latencyMs)} waiting on the model, about ${dollars(usage.investigator.costCents)} (${usage.investigator.priceBasis}).`,
    ...(outcome.mode === "journey"
      ? usage.stages === null
        ? ["- The spend ledger couldn't be read here, so the reading and portrait cost is unknown."]
        : usage.stages.length
          ? ["- Claude calls under this test id, from JOYSTICK's spend ledger:", ...usage.stages.map(stage => `  - ${stage.category}: ${stage.tokens} tokens, about ${dollars(stage.costCents)}`)]
          : ["- No Claude calls were made under this test id."]
      : []),
    `- Estimated total: ${dollars(usage.totalCostCents)}.`,
    `- Time: ${Object.entries(outcome.timings).map(([stage, ms]) => `${stage} ${seconds(ms)}`).join(", ")}.`,
    ...(inv?.notes.length ? [`- Notes: ${inv.notes.join("; ")}`] : []),
    "",
  ];

  if (comparison) {
    lines.push(
      "## Against what you say is true",
      "### Discoveries",
      ...list(comparison.discoveries),
      "### Omissions",
      ...list(comparison.omissions),
      "### Incorrect conclusions",
      ...list(comparison.incorrect),
      "### Not in your expectations (judge these)",
      ...list(comparison.unexpected),
      ""
    );
  } else {
    lines.push("No expectations file was given, so discoveries, omissions and incorrect conclusions are yours to judge below. Pass `--expect <file>` to have them listed.", "");
  }

  lines.push("## Rule checks", ...outcome.checks.map(check => `- ${check.ok ? "PASS" : "FAIL"}: ${check.name}`), "");

  lines.push("## What it concluded");
  if (u.owner) lines.push(`Owner: ${u.owner}`);
  for (const [bucket] of BUCKETS) {
    lines.push(`### ${BUCKET_TITLE[bucket]}`, ...list(u.entities.filter(entity => entity.bucket === bucket).map(entity => `**${entity.name}** (${entity.kind}): ${entity.why ?? ""}${entity.lastActivity ? ` (last activity ${entity.lastActivity})` : ""} [${entity.basis ?? "?"}]${entity.sources.length ? `; sources: ${entity.sources.join("; ")}` : ""}`)));
  }
  lines.push(
    "### People",
    ...list(u.people.map(person => `**${person.name}**${person.role ? `: ${person.role}` : ""}${person.sources.length ? ` (sources: ${person.sources.join("; ")})` : ""}`)),
    "### How names relate",
    ...list(u.relationships.map(rel => `${rel.subject} ${rel.type} ${rel.object} [${rel.basis}, ${rel.confidence}]`)),
    "### Questions Claire would ask (still open)",
    ...list(u.questions),
    `Conflicts kept side by side (an answer and a later inference disagreeing): ${u.conflicts}`,
    ""
  );

  lines.push(
    "## Source coverage",
    "| source | operations | items | ok | empty | partial | failed | not granted | excluded | skipped (budget) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...outcome.coverage.map(row => `| ${row.source} | ${row.operations} | ${row.items} | ${row.ok} | ${row.empty} | ${row.partial} | ${row.failed} | ${row.not_granted} | ${row.excluded} | ${row.skipped_budget} |`),
    "### What couldn't be read completely",
    ...list(u.gaps.map(gap => `${gap.source}: ${gap.state}${gap.reasons.length ? ` (${gap.reasons.join("; ")})` : ""}`)),
    ""
  );

  if (previous) {
    lines.push(
      "## Since the previous run (same source, same kind of test)",
      "### Newly found",
      ...list(previous.newlyFound),
      "### No longer found",
      ...list(previous.noLongerFound),
      "### Concluded differently",
      ...list(previous.moved),
      "### Questions added / dropped",
      ...list([...previous.questionsAdded.map(question => `+ ${question}`), ...previous.questionsDropped.map(question => `- ${question}`)]),
      `Cost ${previous.costCentsDelta >= 0 ? "+" : ""}${dollars(previous.costCentsDelta)}, time ${previous.wallMsDelta >= 0 ? "+" : ""}${seconds(previous.wallMsDelta)}.`,
      ""
    );
  }

  const journey = outcome.journey;
  if (journey) {
    const c = journey.reading.counts;
    lines.push(
      "## The full journey",
      `### The crew's reading: ${journey.reading.status}`,
      `Read ${c.sent} sent and ${c.received} received emails, ${c.events} calendar events, ${c.files} files, ${c.slack} Slack messages.`,
      ...journey.reading.notes.map(note => `- ${note}`),
      "### Crew findings",
      ...list(journey.findings.map(finding => `${finding.companion ?? "crew"} · ${finding.kind}: ${finding.summary} [${finding.status}, ${finding.sources} sources]`)),
      "### Claire's questions",
      ...list(journey.questions.map(item => `${item.question} → ${item.answered ? "answered" : "left"}${item.understood ? `; understood: ${item.understood}` : ""}`)),
      `### The portrait: ${journey.portrait?.status ?? "not written"}`,
      ...(journey.portraitNote ? [`(${journey.portraitNote})`] : []),
      ...(journey.portrait ? [journey.portrait.greeting ?? "", ...journey.portrait.lines.map(line => `> ${line}`), journey.portrait.closing ?? ""].filter(Boolean) : []),
      "### The chapter",
      ...(journey.chapter.opportunity
        ? [
            `- Opportunity: ${journey.chapter.opportunity.type}, ${journey.chapter.opportunity.person ?? "(no name)"} asked for ${journey.chapter.opportunity.wants ?? "something"}${journey.chapter.opportunity.subject ? ` ("${journey.chapter.opportunity.subject}")` : ""}`,
            `- Rests on: ${[journey.chapter.opportunity.service && `service ${journey.chapter.opportunity.service}`, journey.chapter.opportunity.route && `route ${journey.chapter.opportunity.route}`, journey.chapter.opportunity.place && `place ${journey.chapter.opportunity.place}`, journey.chapter.opportunity.along && `along: ${journey.chapter.opportunity.along}`].filter(Boolean).join("; ") || "the request alone"}`,
            `- Played: ${journey.chapter.played.join(", ") || "nothing"}`,
            ...(journey.chapter.draft
              ? [`- Draft at the table (${journey.chapter.draft.status}; ${journey.chapter.draft.left ? "IT LEFT THE TABLE" : "nothing was sent"}): to ${journey.chapter.draft.to ?? "(no name)"}, "${journey.chapter.draft.subject ?? ""}"`, ...(journey.chapter.draft.body ?? "").split(/(?<=[.!?])\s+/).map(sentence => `  > ${sentence}`)]
              : ["- No draft was prepared."]),
          ]
        : ["- No chapter: the crew found no conversation to pick up."]),
      ""
    );
  }

  lines.push("(Message bodies, document text and quotes are never written here; email addresses and phone numbers are taken out, and [redacted] marks redactions.)");
  return lines.join("\n");
}

// ------------------------------------------------------------------ keeping it

/** The newest earlier report of the same kind for the same source journey, in `dir`. */
export function previousOutcome(dir: string, outcome: ColdTestOutcome): ColdTestOutcome | null {
  let files: string[];
  try {
    files = readdirSync(dir).filter(file => file.endsWith(".json"));
  } catch {
    return null;
  }
  const earlier = files
    .map(file => {
      try {
        return JSON.parse(readFileSync(join(dir, file), "utf8")) as ColdTestOutcome;
      } catch {
        return null;
      }
    })
    .filter((item): item is ColdTestOutcome => Boolean(item && item.version === 1 && item.source === outcome.source && item.mode === outcome.mode && item.id !== outcome.id && item.startedAt < outcome.startedAt))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return earlier[0] ?? null;
}

/** The report and its JSON twin, readable by their owner only. */
export function writeColdTestReport(dir: string, outcome: ColdTestOutcome, markdown: string): { markdown: string; json: string } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const base = join(dir, `${outcome.startedAt.replace(/[:.]/g, "-")}-${outcome.mode}-${outcome.id.slice("coldtest-".length, "coldtest-".length + 6)}`);
  writeFileSync(`${base}.json`, `${JSON.stringify(outcome, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(`${base}.md`, `${markdown}\n`, { mode: 0o600 });
  return { markdown: `${base}.md`, json: `${base}.json` };
}
