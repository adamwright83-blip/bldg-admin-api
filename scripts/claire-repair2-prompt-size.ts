/**
 * Claire Intelligence Repair Part 2, Slice A, item 5: prompt size.
 *
 * Reports the static (context-independent) portion of each Claire prompt, per
 * section. The dynamic sections — compiled canon and the verified fact
 * inventory — vary per operator and per day, and are measured live by the
 * per-turn telemetry instead; this script exists so the static floor can be
 * checked from a laptop, with no database.
 *
 *   npx tsx scripts/claire-repair2-prompt-size.ts
 */
import { CLAIRE_V1_REASONING_POLICY } from "../shared/claireRuntime";
import { formatCapabilityBriefing } from "../shared/goldlineCapabilities";
import { GOLDLINE_OFFER_CONTEXT } from "../server/claire/offerContext";
import {
  BLOCKER_REPETITION_DISCIPLINE,
  CLAIRE_TEMPORAL_AUTHORITY_INSTRUCTION,
  VOICE_NATIVE_ANSWER_GUIDANCE,
} from "../server/claire/conversationVoiceGuidance";

const shared = {
  CLAIRE_V1_REASONING_POLICY,
  GOLDLINE_OFFER_CONTEXT,
  BLOCKER_REPETITION_DISCIPLINE,
  CLAIRE_TEMPORAL_AUTHORITY_INSTRUCTION,
  VOICE_NATIVE_ANSWER_GUIDANCE,
  capabilityBriefing: formatCapabilityBriefing(),
};

for (const [name, text] of Object.entries(shared)) {
  console.log(`${String(text.length).padStart(6)}  ${name}`);
}
console.log(
  `${String(Object.values(shared).reduce((sum, text) => sum + text.length, 0)).padStart(6)}  TOTAL (shared blocks only)`
);

/**
 * The assembled follow-up prompt, captured from the real assembly path with an
 * empty drive context, so the numbers cannot drift from the code. Dynamic
 * sections (compiled canon, fact inventory) are near-empty here; production
 * values come from the per-turn telemetry.
 */
async function measureAssembledFollowUp(): Promise<void> {
  const { answerClairePreDriveFollowUp } = await import("../server/claire/preDriveConversation");
  let systemPrompt = "";
  await answerClairePreDriveFollowUp(
    {
      tenantId: "default",
      utterance: "What should I say to them about pricing?",
      brief: "Two commercial stops today; The Louise is the one that matters.",
      context: {
        businessDate: "2026-09-15",
        actorId: "adam-admin",
        macroGoalKnown: false,
        blockers: [],
        relevantTimeline: [],
      } as never,
    },
    {
      invokeText: (async (params: { messages: Array<{ role: string; content: string }> }) => {
        systemPrompt = params.messages.find(message => message.role === "system")?.content ?? "";
        throw new Error("measurement only");
      }) as never,
      recordGeneration: (async (input: { diagnostic: { promptSize?: { totalChars: number; sections: Array<{ label: string; chars: number }> } } }) => {
        const size = input.diagnostic.promptSize;
        if (!size) return;
        console.log("\nfollow-up prompt, per section:");
        for (const section of [...size.sections].sort((a, b) => b.chars - a.chars)) {
          console.log(`${String(section.chars).padStart(6)}  ${section.label}`);
        }
        console.log(`${String(size.totalChars).padStart(6)}  TOTAL`);
      }) as never,
    }
  );
  console.log(`\n${String(systemPrompt.length).padStart(6)}  assembled follow-up system prompt (empty context)`);
  console.log(`${String(systemPrompt.split(". ").length).padStart(6)}  sentence-ish segments`);
}

await measureAssembledFollowUp();

/** The opening brief's prompt, captured the same way. */
async function measureOpeningBrief(): Promise<void> {
  const { writeClairePreDriveBrief } = await import("../server/claire/reasoning");
  await writeClairePreDriveBrief(
    {
      tenantId: "default",
      context: {
        businessDate: "2026-09-15",
        actorId: "adam-admin",
        macroGoalKnown: false,
        blockers: [],
        relevantTimeline: [],
      } as never,
    },
    {
      invokeText: (async () => {
        throw new Error("measurement only");
      }) as never,
      recordGeneration: (async (input: {
        diagnostic: { promptSize?: { totalChars: number; sections: Array<{ label: string; chars: number }> } };
      }) => {
        const size = input.diagnostic.promptSize;
        if (!size) return;
        console.log("\nopening-brief prompt, per section:");
        for (const section of [...size.sections].sort((a, b) => b.chars - a.chars)) {
          console.log(`${String(section.chars).padStart(6)}  ${section.label}`);
        }
        console.log(`${String(size.totalChars).padStart(6)}  TOTAL`);
      }) as never,
    }
  );
}

await measureOpeningBrief();

/** The encyclopedia rewrite's prompt, assembled exactly as encyclopediaAgent does. */
for (const surface of ["voice", "text"] as const) {
  const rewritePrompt = [
    "You are Claire, a concise operations partner. Answer the operator's question using ONLY the record answers provided.",
    surface === "voice" ? "Spoken English, at most 60 words." : "At most 90 words.",
    "Do not add, round, or compute any number that is not written in the record answers. Keep caveats that matter. If the records don't answer part of it, say so briefly.",
    "No mention of tools, records, databases, or models.",
  ].join(" ");
  console.log(`\n${String(rewritePrompt.length).padStart(6)}  encyclopedia rewrite system prompt (${surface})`);
}
