import { describe, expect, it, vi } from "vitest";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import { writeClairePreDriveBrief } from "./reasoning";
import { VOICE_NATIVE_ANSWER_GUIDANCE } from "./conversationVoiceGuidance";
import { GOLDLINE_OFFER_CONTEXT } from "./offerContext";
import {
  CLAIRE_STATIC_INSTRUCTION_BUDGET,
  claireStaticInstructionChars,
} from "./promptDiet";
import type { ClairePromptSizeTrace } from "./answerPathTelemetry";

/**
 * Claire Intelligence Repair Part 2, Slice E — prompt diet.
 *
 * Static instruction (everything except compiled canon, few-shot voice,
 * and the day's fact inventory) must fit in 2,500 characters. Delivery
 * rules stay last. Truth, offer, and voice contracts from PR1 remain.
 */

const CONTEXT = {
  businessDate: "2026-09-15",
  actorId: "adam-admin",
  macroGoalKnown: false,
  blockers: [],
  relevantTimeline: [],
} as never;

async function followUpSize(surface?: "voice" | "desktop"): Promise<{
  system: string;
  size: ClairePromptSizeTrace;
}> {
  let size: ClairePromptSizeTrace | null = null;
  const invokeText = vi.fn(async (params: { messages: Array<{ role: string; content: string }> }) => {
    return "ok";
  });
  await answerClairePreDriveFollowUp(
    {
      tenantId: "default",
      utterance: "What should I say to them about pricing?",
      brief: "Two commercial stops today; The Louise is the one that matters.",
      context: CONTEXT,
      ...(surface ? { surface } : {}),
      onGeneration: diagnostic => {
        size = diagnostic.promptSize ?? null;
      },
    },
    { invokeText: invokeText as never, recordGeneration: vi.fn() as never }
  );
  expect(size).toBeTruthy();
  return { system: invokeText.mock.calls[0]![0].messages[0]!.content as string, size: size! };
}

async function openingSize(): Promise<{ system: string; size: ClairePromptSizeTrace }> {
  let size: ClairePromptSizeTrace | null = null;
  const invokeText = vi.fn(async (params: { messages: Array<{ role: string; content: string }> }) => "Brief.");
  await writeClairePreDriveBrief(
    { tenantId: "default", context: CONTEXT },
    {
      invokeText: invokeText as never,
      recordGeneration: vi.fn(async (input: { diagnostic: { promptSize?: ClairePromptSizeTrace } }) => {
        size = input.diagnostic.promptSize ?? null;
      }) as never,
    }
  );
  expect(size).toBeTruthy();
  return { system: invokeText.mock.calls[0]![0].messages[0]!.content as string, size: size! };
}

describe("Slice E — static instruction diet", () => {
  it("follow-up static instruction is at most 2,500 characters", async () => {
    const { size } = await followUpSize();
    const staticChars = claireStaticInstructionChars(size.sections);
    expect(staticChars).toBeLessThanOrEqual(CLAIRE_STATIC_INSTRUCTION_BUDGET);
  });

  it("opening-brief static instruction is at most 2,500 characters", async () => {
    const { size } = await openingSize();
    const staticChars = claireStaticInstructionChars(size.sections);
    expect(staticChars).toBeLessThanOrEqual(CLAIRE_STATIC_INSTRUCTION_BUDGET);
  });

  it("delivery rules remain last on the voice follow-up path", async () => {
    const { system } = await followUpSize("voice");
    expect(system.endsWith(VOICE_NATIVE_ANSWER_GUIDANCE)).toBe(true);
  });

  it("desktop follow-up still omits voice delivery rules", async () => {
    const { system } = await followUpSize("desktop");
    expect(system).not.toContain("DELIVERY RULES");
  });

  it("offer, truth, and retrieval contracts survive the diet", async () => {
    const { system } = await followUpSize();
    expect(system).toContain(GOLDLINE_OFFER_CONTEXT);
    expect(system).toContain("Business-specific claims (this account, this customer, this property, a specific number, a specific completed action) must be grounded");
    expect(system).toContain("A prior Claire turn is conversation history, not verified truth");
    expect(system).toContain("still answer any judgment asked");
  });
});
