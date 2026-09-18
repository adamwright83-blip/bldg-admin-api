/**
 * PR1 Claire Intelligence Repair -- REAL (non-mocked) Anthropic exam
 * harness. NOT executed by the agent that wrote this file: no working
 * ANTHROPIC_API_KEY was available in that sandboxed environment (confirmed
 * via a direct SDK call returning HTTP 401 authentication_error), and the
 * Railway MCP connection available there is OAuth-scoped and returns
 * variable NAMES only (values redacted) -- it cannot supply a usable key
 * value to run this in-process either. See after-pr1-REAL-transcript.md
 * for the exact blocked-status writeup and the manual procedure to run
 * this for real.
 *
 * This script calls the REAL, unmodified production conversation-
 * generation code path from this branch -- `answerClairePreDriveFollowUp`
 * and `writeClairePreDriveBrief` from server/claire/{preDriveConversation,
 * reasoning}.ts, which in turn call the REAL `invokeTextLLM` (server/_core
 * /llm.ts), which makes a REAL Anthropic API call using
 * `ENV.anthropicModelClaire || ENV.anthropicModel` -- exactly what
 * production would use, no model override, no prompt substitution.
 *
 * Side-effect safety: `recordGeneration` is passed as a no-op dependency
 * (both functions accept it as an injectable dependency, same pattern
 * their own test suites use) so running this NEVER writes to any
 * database, agent-event log, or generation-review log. No Twilio call is
 * placed -- this only exercises the text-generation half of the pipeline.
 * No order, customer record, or any other business-consequential write
 * happens anywhere in this script.
 *
 * HOW TO RUN THIS FOR REAL (see after-pr1-REAL-transcript.md for the full
 * writeup): from a machine with a real `ANTHROPIC_API_KEY` for this
 * account (e.g. via `railway run --service bldg-admin-api -- ...` if you
 * have Railway CLI access to this project, or by exporting the key
 * yourself), from the repo root on this exact branch/SHA:
 *
 *   ANTHROPIC_API_KEY=<real key> npx tsx docs/goldline/claire-intelligence/run-real-exam.ts
 *
 * NOTE on DATABASE_URL: `invokeTextLLM` calls `assertAiSpendAvailable` /
 * `trackModelUsage` (server/agents/costTracking.ts) internally, which is
 * NOT overridden here (only `recordGeneration` is). If a real
 * `DATABASE_URL` is also set when this runs, that will write one small
 * AI-usage-tracking increment per turn under the synthetic tenant id
 * "exam-tenant" -- a low-risk telemetry row, not a business/customer write,
 * but not literally zero DB writes either. If Adam wants a fully DB-write-
 * free run, run this with a local/throwaway `DATABASE_URL` (or none) so
 * that call fails closed instead, or without one at all -- it does not
 * block generation either way (costTracking fails open on DB errors).
 *
 * It writes docs/goldline/claire-intelligence/after-pr1-REAL-transcript.md
 * and after-pr1-REAL-metrics.json with the RAW, unedited model output --
 * do not hand-edit those files afterward; if a turn looks bad or
 * off-character, that is exactly the finding this exam exists to surface.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { answerClairePreDriveFollowUp } from "../../../server/claire/preDriveConversation";
import { writeClairePreDriveBrief } from "../../../server/claire/reasoning";
import { ENV } from "../../../server/_core/env";
import {
  buildClaireClock,
  CLAIRE_BUSINESS_TIME_ZONE,
  type ClaireDriveContext,
} from "../../../server/claire/contextAssembler";
import type { ClaireGenerationDiagnostic } from "../../../server/claire/generationTelemetry";

// PR1 Claire Intelligence Repair -- corrective pass (real-exam finding,
// root-cause fix per Adam's explicit instruction): the first real exam run
// built `scheduledAt` as `new Date(Date.now() + 3 * 3600_000)` with no
// timezone context anywhere in the fixture (`context.clock` was omitted
// entirely), so the model had nothing but a bare UTC instant to reason
// from and misread it as "just before midnight." Root cause was
// determined to be IN THE FIXTURE, not in production: production's real
// assembleClaireDriveContext (server/claire/contextAssembler.ts) always
// calls buildClaireClock() and attaches the result as `context.clock`
// before nextFixedCommitment is even assembled -- so a real call always
// carries a resolved business timezone. This fixture now mirrors that
// real shape exactly (buildClaireClock(now, CLAIRE_BUSINESS_TIME_ZONE)),
// instead of inventing a differently-shaped ad hoc clock object, so it
// cannot silently drift from what production actually sends again. See
// docs/goldline/CLAIRE_INTELLIGENCE_PR1_HANDOFF.md for the full
// root-cause writeup.
function zonedWallTimeToUtc(y: number, m: number, d: number, h: number, min: number, timeZone: string): Date {
  const utcGuess = Date.UTC(y, m - 1, d, h, min);
  const asZoned = new Date(new Date(utcGuess).toLocaleString("en-US", { timeZone }));
  const driftMs = utcGuess - asZoned.getTime();
  return new Date(utcGuess + driftMs);
}

// Frozen JOYSTICK pre-visit specimen. Recovered from the original real
// exam transcript (`after-pr1-REAL-transcript.md` Generated:
// 2026-09-17T22:18:39.945Z) and the already-intended Railway freeze
// 2026-09-17T22:18:00.000Z. Local clock: Thursday 2026-09-17 3:18 PM
// America/Los_Angeles, daypart afternoon, field day open. Next commitment
// remains The Wilshire at 5:00 PM the same local day. Wall-clock
// execution time must not mutate this specimen.
const FROZEN_EXAM_NOW_ISO = "2026-09-17T22:18:00.000Z";
const now = new Date(FROZEN_EXAM_NOW_ISO);
const clock = buildClaireClock(now, CLAIRE_BUSINESS_TIME_ZONE);
// A concrete business-local time (5pm business timezone, today) --
// matches how a real scheduled commercial visit would actually be stored,
// rather than an arbitrary UTC offset from "now" that could roll across a
// day boundary in an unintuitive way.
const [year, month, day] = clock.businessDate.split("-").map(Number);
const scheduledAtLocal5pm = zonedWallTimeToUtc(year, month, day, 17, 0, CLAIRE_BUSINESS_TIME_ZONE);

const context: ClaireDriveContext = {
  phase: "pre_drive",
  generatedAt: now.toISOString(),
  businessDate: clock.businessDate,
  actorId: "exam-operator",
  truthLaw: "game_projection_never_creates_business_truth",
  clock,
  macroGoalKnown: true,
  macroGoal: { id: "goal-1", metricKey: "active_customers", targetValue: 500, unit: "active customers" },
  nextFixedCommitment: {
    id: "visit-42",
    kind: "commercial_visit",
    title: "The Wilshire",
    subtitle: "Commercial visit",
    urgency: "today",
    scheduledAt: scheduledAtLocal5pm.toISOString(),
    destination: "100 Wilshire Boulevard",
    sourceReference: "commercial_missions:42",
    whySurfaced: "scheduled",
    actions: [],
  },
  blockers: [{ id: "blocker-1", title: "Waiting on gate code from The Wilshire" } as never],
  relevantTimeline: [],
  mission: null,
};

type ExamTurn = {
  category: string;
  label: string;
  kind: "opening_brief" | "follow_up";
  utterance?: string;
  recentTurns?: Array<{ speaker: "operator" | "claire"; text: string }>;
};

const TURNS: ExamTurn[] = [
  { category: "opening_brief", label: "opening brief", kind: "opening_brief" },
  {
    category: "ordinary",
    label: "ordinary conversational check-in",
    kind: "follow_up",
    utterance: "Morning. What's on today?",
  },
  {
    category: "continuity",
    label: "reference 2-4 turns back",
    kind: "follow_up",
    utterance: "So is he going to be there this time?",
    recentTurns: [
      { speaker: "operator", text: "I'm headed to The Wilshire again." },
      { speaker: "claire", text: "Right, the one where the PM was out last time." },
      { speaker: "operator", text: "Yeah, exactly." },
      { speaker: "claire", text: "You said he was out sick, not just unavailable." },
    ],
  },
  {
    category: "strategic_reasoning",
    label: "what would you do / why / what am I missing",
    kind: "follow_up",
    utterance: "What am I missing here, strategically, before I go in?",
  },
  {
    category: "correction",
    label: "operator corrects Claire",
    kind: "follow_up",
    utterance: "No, it's The Wilshire, not the Colosseum building.",
    recentTurns: [{ speaker: "operator", text: "Heading to the Colosseum building now." }],
  },
  {
    category: "general_knowledge",
    label: "general business knowledge as advice, not fact",
    kind: "follow_up",
    utterance: "If they push back on price, what's a good way to handle that?",
  },
  {
    category: "truth_boundary",
    label: "fact absent from verified context",
    kind: "follow_up",
    utterance: "Do they already use a competitor for laundry?",
  },
  {
    category: "personal",
    label: "question about Claire personally, tier-gating should hold",
    kind: "follow_up",
    utterance: "Where are you from, Claire?",
  },
  {
    category: "background_flavor",
    label: "background should subtly shape reasoning style, not be stated outright",
    kind: "follow_up",
    utterance: "How should I even start figuring out what's really going on with this account?",
  },
  {
    category: "dry_personality",
    label: "surface dry/direct personality without theatrics",
    kind: "follow_up",
    utterance: "You think I've got this one in the bag?",
  },
  {
    category: "complex",
    label: "complicated question needing a substantive answer",
    kind: "follow_up",
    utterance:
      "Walk me through the whole plan for this property: what to do if the PM stalls, what to ask about their current laundry setup, and what the fallback play is if they say no.",
  },
  {
    category: "simple",
    label: "simple question, short answer",
    kind: "follow_up",
    utterance: "What time's the stop?",
  },
];

function frozenSpecimenFingerprint() {
  const payload = {
    frozenNowIso: FROZEN_EXAM_NOW_ISO,
    timeZone: CLAIRE_BUSINESS_TIME_ZONE,
    clock,
    generatedAt: context.generatedAt,
    businessDate: context.businessDate,
    actorId: context.actorId,
    tenantId: "exam-tenant",
    brief: "Visit The Wilshire.",
    nextFixedCommitment: context.nextFixedCommitment,
    blockers: context.blockers,
    macroGoal: context.macroGoal,
    relevantTimeline: context.relevantTimeline,
    mission: context.mission,
    turns: TURNS,
  };
  const canonical = JSON.stringify(payload);
  return {
    sha256: createHash("sha256").update(canonical).digest("hex"),
    payload,
  };
}

async function run() {
  const specimen = frozenSpecimenFingerprint();
  console.log(`FROZEN_SPECIMEN_SHA256=${specimen.sha256}`);
  console.log(`FROZEN_SPECIMEN_NOW=${FROZEN_EXAM_NOW_ISO}`);
  console.log(`FROZEN_SPECIMEN_CLOCK=${JSON.stringify(clock)}`);
  console.log(`FROZEN_SPECIMEN_COMMITMENT=${JSON.stringify(context.nextFixedCommitment)}`);
  const transcriptLines: string[] = [
    "# Claire PR1 -- REAL (non-mocked) Anthropic exam transcript",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Frozen specimen now: ${FROZEN_EXAM_NOW_ISO}`,
    `Frozen specimen sha256: ${specimen.sha256}`,
    `Frozen clock: ${JSON.stringify(clock)}`,
    `Model requested: ${ENV.anthropicModelClaire || ENV.anthropicModel} (ENV.anthropicModelClaire || ENV.anthropicModel -- unchanged production config, no override).`,
    "",
    "**This transcript is RAW model output from the actual production code path",
    "(answerClairePreDriveFollowUp / writeClairePreDriveBrief -> invokeTextLLM ->",
    "real Anthropic API). Nothing below is rewritten, curated, or cherry-picked.**",
    "No database write occurred (recordGeneration is a no-op for this run). No",
    "Twilio call was placed. Wall-clock execution time did not mutate the frozen specimen.",
    "",
  ];
  const metrics: Array<Record<string, unknown>> = [];

  for (const turn of TURNS) {
    let diagnostic: ClaireGenerationDiagnostic | undefined;
    const startedAt = Date.now();
    let result: string;
    // recordGeneration is EXPLICITLY overridden to a no-op below on every
    // call -- this is what guarantees no database/agent-event/generation-
    // log write happens. Do not remove this when adapting the script.
    const noOpRecordGeneration = async () => {};
    if (turn.kind === "follow_up") {
      result = await answerClairePreDriveFollowUp(
        {
          tenantId: "exam-tenant",
          utterance: turn.utterance ?? "",
          brief: "Visit The Wilshire.",
          context,
          recentTurns: turn.recentTurns,
          onGeneration: d => { diagnostic = d; },
        },
        { recordGeneration: noOpRecordGeneration }
      );
    } else {
      result = await writeClairePreDriveBrief(
        {
          tenantId: "exam-tenant",
          context,
          onGeneration: d => { diagnostic = d; },
        },
        { recordGeneration: noOpRecordGeneration }
      );
    }
    const latencyMs = Date.now() - startedAt;

    transcriptLines.push(`## [${turn.category}] ${turn.label}`);
    if (turn.utterance) transcriptLines.push(`- Operator: "${turn.utterance}"`);
    if (turn.recentTurns?.length) {
      transcriptLines.push(`- Recent turns supplied: ${JSON.stringify(turn.recentTurns)}`);
    }
    transcriptLines.push(`- RAW Claire response: "${result}"`);
    transcriptLines.push(`- Source: ${diagnostic?.answerOrigin ?? diagnostic?.source ?? "unknown"}${diagnostic?.failureReason ? ` (reason: ${diagnostic.failureReason})` : ""}`);
    transcriptLines.push(`- Model requested: ${diagnostic?.modelRequested ?? "(unknown)"}`);
    transcriptLines.push(`- stop_reason: ${diagnostic?.stopReason ?? "(not captured)"}`);
    transcriptLines.push(`- Sentence-boundary trim applied: ${diagnostic?.trimmedToSentenceBoundary == null ? "n/a" : diagnostic.trimmedToSentenceBoundary ? "yes" : "no"}`);
    transcriptLines.push(`- Character mode: ${turn.kind === "opening_brief" ? "pre_drive (opening)" : "pre_drive (follow_up)"}`);
    transcriptLines.push(`- Generation latency: ${latencyMs}ms`);
    transcriptLines.push("");

    metrics.push({
      category: turn.category,
      label: turn.label,
      kind: turn.kind,
      rawResponse: result,
      source: diagnostic?.answerOrigin ?? diagnostic?.source ?? null,
      legacyGenerationSource: diagnostic?.source ?? null,
      failureReason: diagnostic?.failureReason ?? null,
      modelRequested: diagnostic?.modelRequested ?? null,
      stopReason: diagnostic?.stopReason ?? null,
      trimmedToSentenceBoundary: diagnostic?.trimmedToSentenceBoundary ?? null,
      latencyMs,
    });
  }

  writeFileSync("docs/goldline/claire-intelligence/after-pr1-REAL-transcript.md", transcriptLines.join("\n"));
  writeFileSync(
    "docs/goldline/claire-intelligence/after-pr1-REAL-metrics.json",
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        frozenNowIso: FROZEN_EXAM_NOW_ISO,
        frozenSpecimenSha256: specimen.sha256,
        frozenClock: clock,
        modelRequested: ENV.anthropicModelClaire || ENV.anthropicModel,
        turns: metrics,
      },
      null,
      2
    )
  );
  writeFileSync(
    "docs/goldline/claire-intelligence/frozen-exam-specimen.json",
    JSON.stringify({ sha256: specimen.sha256, ...specimen.payload }, null, 2)
  );
  console.log(`Wrote REAL transcript + metrics for ${metrics.length} turns.`);
}

run();
