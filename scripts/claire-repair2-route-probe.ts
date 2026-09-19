/**
 * Claire Intelligence Repair Part 2 — C+D route probe.
 *
 * Exercises the live router (`decideClaireAnswerRoute` via `runClaireTurn`),
 * not JUDGMENT_CLAUSE / classifyClaireAnswerClass. Those remain telemetry.
 *
 *   npx tsx scripts/claire-repair2-route-probe.ts
 */
import { runBusinessQuery } from "../server/analytics/businessQuery";
import { loadPaidOrderLedger } from "../server/analytics/paidOrderLedger";
import { classifyClaireAnswerClass } from "../server/claire/answerPathTelemetry";
import type { EncyclopediaAnswer } from "../server/claire/knowledge/encyclopediaAgent";
import {
  BUSINESS_NOW,
  BUSINESS_TZ,
  businessCompleteness,
  businessFreshness,
  businessLoaders,
} from "../server/claire/testSupport/claireBusinessFixture";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnTraceForTest } from "../server/claire/turn/claireTurn";

const NOW = BUSINESS_NOW;

const MINIMAL_BRIEF = "Two commercial stops today; The Louise is the one that matters.";
const MINIMAL_CONTEXT = {
  businessDate: "2026-09-15",
  actorId: "adam-admin",
  macroGoalKnown: false,
  blockers: [],
  relevantTimeline: [],
} as never;

const LOUISE_HISTORY = {
  account: { id: 1, name: "The Louise", kind: "account" } as never,
  missions: [],
  events: [],
  fieldVisits: [
    {
      missionId: 1,
      arrivedAt: "2026-09-08T18:00:00Z",
      departedAt: "2026-09-08T18:30:00Z",
      notes: "Toured the basement laundry room.",
    },
  ],
  outcomes: [],
  followUps: [],
  pipelineStage: null,
  pipelineId: null,
  contacts: [],
  dayLineMentions: [],
  conversationMentions: [
    {
      sessionId: "probe-1",
      at: "2026-09-15T16:00:00.000Z",
      speaker: "OPERATOR",
      text: "The Louise wants a quote before month end.",
    },
  ],
};

function turnDeps(overrides: Partial<ClaireTurnDeps> = {}): ClaireTurnDeps {
  return {
    now: () => NOW,
    timeZone: () => BUSINESS_TZ,
    business: {
      now: () => NOW,
      timeZone: () => BUSINESS_TZ,
      plan: async () => null,
      runQuery: (tenantId, query) =>
        runBusinessQuery(tenantId, query, {
          loadLedger: input => loadPaidOrderLedger(input, businessLoaders()),
          loadOpenOrders: async () => ({ openTotal: 2, byStatus: {}, awaitingPayment: 1 }),
          loadCompleteness: async () => businessCompleteness,
          loadFreshness: async () => businessFreshness(),
          now: () => NOW,
          timeZone: () => BUSINESS_TZ,
        }),
    },
    commitment: (async () => ({ kind: "not_applicable" as const })) as never,
    followUp: (async (input: { utterance: string; retrievedEvidence?: Array<{ source: string; text: string }> }) =>
      `SYNTH:${input.retrievedEvidence?.length ?? 0}`) as never,
    extractModel: null,
    loadExisting: async () => [],
    commit: (async () => ({ commitmentIds: [] })) as never,
    campaign: async () => null,
    vocabulary: async () => [],
    accounts: async () => [
      { id: 1, name: "The Louise", kind: "account" } as never,
      { id: 2, name: "OPUS LA", kind: "account" } as never,
    ],
    accountHistory: (async () => LOUISE_HISTORY) as never,
    commitFollowUp: (async () => ({ ok: true })) as never,
    dayWork: (async () => ({ open: [], completed: [], businessDate: "2026-09-15" })) as never,
    unpaid: (async () => []) as never,
    searchMemory: (async () => [
      { speaker: "OPERATOR", text: "We decided the Greystar campaign stays at ten doors.", occurredAt: NOW },
    ]) as never,
    memoryBetween: (async () => []) as never,
    encyclopedia: null,
    watchBoard: undefined,
    doctrineTurn: undefined,
    ...overrides,
  };
}

const REQUIRED: Array<{
  question: string;
  encyclopedia?: EncyclopediaAnswer;
}> = [
  { question: "What was revenue last month?" },
  { question: "Why do property managers keep stalling on this?" },
  { question: "What did I tell you about The Louise?" },
  { question: "What did I tell you about The Louise, and what should I do?" },
  { question: "Remind me what we decided about the Greystar campaign." },
  {
    question: "What do we know about their pricing objection, and how should I handle it?",
    encyclopedia: {
      kind: "answered",
      text: "No pricing objection is recorded.",
      fullyAnswers: false,
      evidence: [{ source: "account", text: "No pricing objection is recorded." }],
    },
  },
  { question: "What happened at The Louise last time, and what should I do?" },
  { question: "How many orders did they place, and is it worth another visit?" },
  { question: "Deliver towels to OPUS LA. Should I go back to The Louise?" },
  {
    question: "Tomorrow return John's laundry. What happened with The Louise last time, and should I stop there too?",
  },
];

async function probe(question: string, encyclopedia?: EncyclopediaAnswer) {
  let trace: ClaireTurnTraceForTest | null = null;
  let followUpCalled = false;
  let retrievedEvidence: Array<{ source: string; text: string }> | undefined;
  const result = await runClaireTurn(
    {
      tenantId: "default",
      operatorUserId: "adam-admin",
      dayDirectorActorId: "1",
      surface: "voice",
      utterance: question,
      state: {},
      conversationKey: "claire-repair2-route-probe",
      brief: MINIMAL_BRIEF,
      context: MINIMAL_CONTEXT,
    },
    turnDeps({
      encyclopedia: encyclopedia
        ? (async () => encyclopedia)
        : null,
      followUp: (async (input: { utterance: string; retrievedEvidence?: Array<{ source: string; text: string }> }) => {
        followUpCalled = true;
        retrievedEvidence = input.retrievedEvidence;
        return `SYNTH:${input.retrievedEvidence?.length ?? 0}`;
      }) as never,
      onTurnTrace: value => {
        trace = value;
      },
    })
  );
  return { result, trace, followUpCalled, retrievedEvidence };
}

function label(outcome: string | null | undefined, path: string | null | undefined): string {
  switch (outcome) {
    case "deterministic_final":
      return `deterministic final (${path ?? "reader"})`;
    case "retrieval_plus_synthesis":
      return "retrieval + synthesis";
    case "judgment_synthesis_no_retrieval":
      return "judgment synthesis with no retrieval";
    case "unsupported_fact":
      return "unsupported fact";
    case "briefing_plus_synthesis":
      return "briefing + synthesis";
    default:
      return `unlabelled (path=${path ?? "none"})`;
  }
}

async function main() {
  const width = Math.max(...REQUIRED.map(row => row.question.length));
  console.log("Claire repair 2 C+D route probe — live router, not regex\n");
  console.log(
    `${"QUESTION".padEnd(width)}  ${"REGEX CLASS (telemetry only)".padEnd(28)}  ROUTER OUTCOME`
  );
  const rows: Array<{ question: string; outcome: string; regex: string; synthesis: boolean }> = [];
  for (const row of REQUIRED) {
    const { result, trace, followUpCalled, retrievedEvidence } = await probe(row.question, row.encyclopedia);
    const regex = classifyClaireAnswerClass(row.question);
    const outcome = label(trace?.routeOutcome, trace?.path);
    rows.push({
      question: row.question,
      outcome,
      regex,
      synthesis: Boolean(trace?.synthesisRequired || followUpCalled),
    });
    const sources = retrievedEvidence?.map(item => item.source).join(",") || trace?.evidenceSources.join(",") || "—";
    console.log(
      `${row.question.padEnd(width)}  ${regex.padEnd(28)}  ${outcome}  [path=${trace?.path ?? "none"} kind=${result.kind} evidence=${sources}]`
    );
  }

  console.log("\nRegex is telemetry only. The following rows synthesize even though the old class said fact_only:");
  for (const row of rows.filter(item => item.regex === "fact_only" && item.synthesis)) {
    console.log(`  • ${row.question}`);
  }

  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    const key = row.outcome.replace(/ \(.+\)$/, "");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  console.log("\nOutcome counts:");
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key}: ${value}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
