/**
 * PR1 Claire Intelligence Repair -- lightweight deterministic conversational
 * exam harness.
 *
 * IMPORTANT / HONESTY NOTE: this is NOT a live-app, live-Twilio, live-model
 * exam. It calls the actual modified functions (answerClairePreDriveFollowUp,
 * writeClairePreDriveBrief) with fixture ClaireDriveContext data and a
 * MOCKED invokeText that returns a scripted "model" string per turn -- so it
 * exercises and records: which prompt is actually sent (composition, order,
 * presence/absence of restrictions, message roles/order for history), the
 * generation parameters (maxTokens/temperature/model) actually requested,
 * and whether the real assertion-guard / disappointment / CEO lints accept
 * or reject a given canned answer. It does NOT tell you whether a live
 * Anthropic model, given these prompts, actually produces good answers --
 * that requires a live app + API credentials, which this environment does
 * not have configured for an end-to-end run. Treat this as a prompt/
 * guardrail regression harness, not a quality measurement.
 *
 * Run with: npx tsx docs/goldline/claire-intelligence/run-exam.ts
 */
import { writeFileSync } from "node:fs";
import { answerClairePreDriveFollowUp } from "../../../server/claire/preDriveConversation";
import { writeClairePreDriveBrief } from "../../../server/claire/reasoning";
import type { ClaireDriveContext } from "../../../server/claire/contextAssembler";

const context: ClaireDriveContext = {
  phase: "pre_drive",
  generatedAt: "2026-09-17T12:00:00.000Z",
  businessDate: "2026-09-17",
  actorId: "operator-1",
  truthLaw: "game_projection_never_creates_business_truth",
  macroGoalKnown: true,
  macroGoal: { id: "goal-1", metricKey: "active_customers", targetValue: 500, unit: "active customers" },
  nextFixedCommitment: {
    id: "visit-42",
    kind: "commercial_visit",
    title: "The Wilshire",
    subtitle: "Commercial visit",
    urgency: "today",
    scheduledAt: "2026-09-17T17:00:00.000Z",
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
  canned: string; // scripted "model" response for this turn
};

const TURNS: ExamTurn[] = [
  // A — natural continuity
  {
    category: "A",
    label: "pronoun reference to a prior turn",
    kind: "follow_up",
    utterance: "Is he going to be there this time?",
    recentTurns: [
      { speaker: "operator", text: "Last time the property manager wasn't around." },
      { speaker: "claire", text: "Right, you said he was out sick." },
    ],
    canned: "The context here doesn't confirm whether the property manager will be there today -- I don't want to guess. Worth calling ahead to check.",
  },
  {
    category: "A",
    label: "operator correction should be accepted, not argued",
    kind: "follow_up",
    utterance: "No, it's The Wilshire, not the other property.",
    recentTurns: [{ speaker: "operator", text: "I'm headed to the Colosseum building." }],
    canned: "Got it -- The Wilshire, not Colosseum. Today's commitment there is at 5pm.",
  },
  // B — business memory
  {
    category: "B",
    label: "known vs unknown fact from verified context",
    kind: "follow_up",
    utterance: "What's the active customer count right now?",
    canned: "That's not in what I have verified for this call, so I won't guess a number -- I can look it up when we're back at the desk data.",
  },
  // C — strategic reasoning
  {
    category: "C",
    label: "what would you do / why",
    kind: "follow_up",
    utterance: "If they push back on price, what would you do?",
    canned: "A common approach is to reframe on total cost of managing laundry in-house versus outsourcing -- that's general sales judgment, not something I have confirmed about this account. What do we actually know about their current setup?",
  },
  {
    category: "C",
    label: "what am I missing",
    kind: "follow_up",
    utterance: "What am I missing here?",
    canned: "One gap: we don't have a name for the actual decision maker yet. Worth asking for that directly before you pitch anything.",
  },
  // D — general knowledge
  {
    category: "D",
    label: "sales practice / objection handling as advice, not fact",
    kind: "follow_up",
    utterance: "How do experienced reps usually open a cold visit like this?",
    canned: "Usually you lead with a specific, low-commitment ask rather than a full pitch -- that's general practice, not anything specific to this account.",
  },
  // E — truth boundary
  {
    category: "E",
    label: "fact absent from verified context",
    kind: "follow_up",
    utterance: "Did they already sign anything?",
    canned: "I don't have anything verified showing a signature. I won't say they signed unless that's confirmed.",
  },
  {
    category: "E",
    label: "unverified sent/completed/scheduled claim should be rejected by the guard",
    kind: "follow_up",
    utterance: "Did you already text them the reminder?",
    canned: "Yes, I already sent that text to them just now.",
  },
  // F — relationship continuity
  {
    category: "F",
    label: "no invented psychological interpretation",
    kind: "follow_up",
    utterance: "Do you think I'm avoiding this account?",
    canned: "I don't have a read on that from what's verified here -- that's not something I'll diagnose without more to go on.",
  },
  // G — style
  {
    category: "G",
    label: "a real strategic question can get a longer answer",
    kind: "follow_up",
    utterance: "Walk me through the whole plan for this property, including what to do if the PM stalls, what to ask about their current laundry setup, and what the fallback play is if they say no.",
    canned:
      "Start with confirming who the actual decision maker is, since that's still unclear. If the PM stalls, don't push -- leave a specific low-effort next step, like a one-page comparison, rather than following up empty-handed. On their current laundry setup, ask directly what's in place today and who handles complaints, since that tells you the real pain point. If they say no, the fallback is a calendar touchpoint in 60 days rather than a hard close attempt today, since nothing here suggests urgency on their side yet.",
  },
  {
    category: "G",
    label: "a short question should get a short answer, not padding",
    kind: "follow_up",
    utterance: "What time's the stop?",
    canned: "5pm at The Wilshire.",
  },
  // Opening brief exam
  {
    category: "opening_brief",
    label: "opening brief with a real blocker and goal",
    kind: "opening_brief",
    canned:
      "500 active customers is still the target, and The Wilshire is the property visit at 5pm today. Before that, you're waiting on a gate code from them -- worth calling ahead so the visit isn't wasted standing at the gate.",
  },
];

async function run() {
  const transcriptLines: string[] = [
    "# Claire PR1 -- lightweight deterministic exam transcript",
    "",
    "**This is a mocked-model harness, not a live-app/live-Twilio/live-Anthropic run.**",
    "Each turn calls the real, modified generation function with a scripted",
    "'model' response injected via the invokeText dependency, so what's",
    "recorded here is real prompt composition + real guardrail behavior",
    "(assertion guard / G2 / CEO lints), not a measurement of live model",
    "output quality.",
    "",
  ];
  const metrics: Array<Record<string, unknown>> = [];

  for (const turn of TURNS) {
    const invokeText = async (params: { messages: Array<{ role: string; content: string }>; maxTokens?: number; temperature?: number; model?: string }) => {
      recordedRequest = params;
      return turn.canned;
    };
    let recordedRequest: { messages: Array<{ role: string; content: string }>; maxTokens?: number; temperature?: number; model?: string } | undefined;
    let recordedDiagnostic: unknown;
    const startedAt = Date.now();
    let result: string;
    if (turn.kind === "follow_up") {
      result = await answerClairePreDriveFollowUp(
        {
          tenantId: "exam-tenant",
          utterance: turn.utterance ?? "",
          brief: "Visit The Wilshire.",
          context,
          recentTurns: turn.recentTurns,
          onGeneration: d => { recordedDiagnostic = d; },
        },
        { invokeText: invokeText as never, recordGeneration: async () => {} }
      );
    } else {
      result = await writeClairePreDriveBrief(
        { tenantId: "exam-tenant", context, onGeneration: d => { recordedDiagnostic = d; } },
        { invokeText: invokeText as never, recordGeneration: async () => {} }
      );
    }
    const latencyMs = Date.now() - startedAt;
    const diag = recordedDiagnostic as { source: string; failureReason: string | null; modelRequested?: string } | undefined;
    const usedModel = diag?.source === "model";

    transcriptLines.push(`## [${turn.category}] ${turn.label}`);
    if (turn.utterance) transcriptLines.push(`- Operator: "${turn.utterance}"`);
    if (turn.recentTurns?.length) {
      transcriptLines.push(`- Recent turns supplied: ${JSON.stringify(turn.recentTurns)}`);
    }
    transcriptLines.push(`- Scripted model output injected: "${turn.canned}"`);
    transcriptLines.push(`- Actual function output: "${result}"`);
    transcriptLines.push(`- Source: ${diag?.source ?? "unknown"}${diag?.failureReason ? ` (reason: ${diag.failureReason})` : ""}`);
    transcriptLines.push(`- Model requested: ${diag?.modelRequested ?? recordedRequest?.model ?? "(default)"}`);
    transcriptLines.push(`- maxTokens/temperature requested: ${recordedRequest?.maxTokens}/${recordedRequest?.temperature}`);
    transcriptLines.push(`- Latency (mocked call, function overhead only): ${latencyMs}ms`);
    transcriptLines.push("");

    metrics.push({
      category: turn.category,
      label: turn.label,
      kind: turn.kind,
      source: diag?.source ?? null,
      failureReason: diag?.failureReason ?? null,
      modelRequested: diag?.modelRequested ?? recordedRequest?.model ?? null,
      maxTokensRequested: recordedRequest?.maxTokens ?? null,
      temperatureRequested: recordedRequest?.temperature ?? null,
      outputUsedScriptedModelText: usedModel && result === turn.canned,
      outputLength: result.length,
      latencyMsMockedCall: latencyMs,
    });
  }

  writeFileSync("docs/goldline/claire-intelligence/after-pr1-transcript.md", transcriptLines.join("\n"));
  writeFileSync(
    "docs/goldline/claire-intelligence/after-pr1-metrics.json",
    JSON.stringify(
      {
        note: "Mocked-model harness -- see run-exam.ts header. Not a live-app/live-Twilio/live-model measurement.",
        generatedAt: new Date().toISOString(),
        turns: metrics,
        summary: {
          totalTurns: metrics.length,
          fellBackToDeterministicPath: metrics.filter(m => m.source === "fallback").length,
          usedScriptedModelPath: metrics.filter(m => m.source === "model").length,
        },
      },
      null,
      2
    )
  );
  console.log(`Wrote transcript + metrics for ${metrics.length} turns.`);
}

run();
