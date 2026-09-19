import { describe, expect, it, vi } from "vitest";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import { writeClairePreDriveBrief } from "./reasoning";
import { CLAIRE_TEMPORAL_AUTHORITY_INSTRUCTION, VOICE_NATIVE_ANSWER_GUIDANCE } from "./conversationVoiceGuidance";
import { GOLDLINE_OFFER_CONTEXT } from "./offerContext";
import {
  CLAIRE_STATIC_INSTRUCTION_BUDGET,
  claireStaticInstructionChars,
} from "./promptDiet";
import type { ClairePromptSizeTrace } from "./answerPathTelemetry";

/**
 * Claire Intelligence Repair Part 2, Slice E — prompt diet.
 *
 * Static instruction is everything except compiled canon, few-shot voice,
 * and the day's fact inventory. Conditional blocks (retrieved evidence,
 * MissionSalesBrief) are still static when present. Every valid prompt
 * configuration must fit in 2,500 characters.
 */

const CONTEXT = {
  businessDate: "2026-09-15",
  actorId: "adam-admin",
  macroGoalKnown: false,
  blockers: [],
  relevantTimeline: [],
} as never;

const MISSION_SALES_BRIEF = {
  briefId: 42,
  version: 2,
  primaryObjective: "Identify the corporate approval path.",
  keyKnownFacts: ["Management previously showed interest."],
  keyUnknown: "Who owns vendor approval?",
  recommendedOpening: null,
  questionsToAsk: ["Who approves new vendors?"],
  thingsToAvoid: ["Repeating the introductory pitch."],
  frameworkId: null,
};

const RETRIEVED_EVIDENCE = [
  { source: "account_history", text: "Dana was out. Front desk said come back after Labor Day." },
];

async function followUpSize(input: {
  surface?: "voice" | "desktop";
  retrievedEvidence?: Array<{ source: string; text: string }>;
  missionSalesBrief?: typeof MISSION_SALES_BRIEF;
}): Promise<{ system: string; size: ClairePromptSizeTrace; staticChars: number }> {
  let size: ClairePromptSizeTrace | null = null;
  const invokeText = vi.fn(async () => "ok");
  await answerClairePreDriveFollowUp(
    {
      tenantId: "default",
      utterance: "What should I say to them about pricing?",
      brief: "Two commercial stops today; The Louise is the one that matters.",
      context: {
        ...CONTEXT,
        ...(input.missionSalesBrief ? { missionSalesBrief: input.missionSalesBrief } : {}),
      },
      ...(input.surface ? { surface: input.surface } : {}),
      ...(input.retrievedEvidence ? { retrievedEvidence: input.retrievedEvidence } : {}),
      onGeneration: diagnostic => {
        size = diagnostic.promptSize ?? null;
      },
    },
    { invokeText: invokeText as never, recordGeneration: vi.fn() as never }
  );
  expect(size).toBeTruthy();
  const staticChars = claireStaticInstructionChars(size!.sections);
  return { system: invokeText.mock.calls[0]![0].messages[0]!.content as string, size: size!, staticChars };
}

async function openingSize(input: {
  missionSalesBrief?: typeof MISSION_SALES_BRIEF;
}): Promise<{ system: string; size: ClairePromptSizeTrace; staticChars: number }> {
  let size: ClairePromptSizeTrace | null = null;
  const invokeText = vi.fn(async () => "Brief.");
  await writeClairePreDriveBrief(
    {
      tenantId: "default",
      context: {
        ...CONTEXT,
        ...(input.missionSalesBrief ? { missionSalesBrief: input.missionSalesBrief } : {}),
      },
    },
    {
      invokeText: invokeText as never,
      recordGeneration: vi.fn(async (record: { diagnostic: { promptSize?: ClairePromptSizeTrace } }) => {
        size = record.diagnostic.promptSize ?? null;
      }) as never,
    }
  );
  expect(size).toBeTruthy();
  const staticChars = claireStaticInstructionChars(size!.sections);
  return { system: invokeText.mock.calls[0]![0].messages[0]!.content as string, size: size!, staticChars };
}

describe("Slice E — static instruction diet", () => {
  const matrix: Array<{
    name: string;
    run: () => Promise<{ system: string; staticChars: number }>;
  }> = [
    { name: "follow-up: neither conditional", run: () => followUpSize({}) },
    { name: "follow-up: retrieved evidence only", run: () => followUpSize({ retrievedEvidence: RETRIEVED_EVIDENCE }) },
    { name: "follow-up: mission brief only", run: () => followUpSize({ missionSalesBrief: MISSION_SALES_BRIEF }) },
    {
      name: "follow-up: both",
      run: () => followUpSize({ retrievedEvidence: RETRIEVED_EVIDENCE, missionSalesBrief: MISSION_SALES_BRIEF }),
    },
    { name: "opening: no mission brief", run: () => openingSize({}) },
    { name: "opening: mission brief present", run: () => openingSize({ missionSalesBrief: MISSION_SALES_BRIEF }) },
  ];

  for (const row of matrix) {
    it(`${row.name} stays at most ${CLAIRE_STATIC_INSTRUCTION_BUDGET} static characters`, async () => {
      const { staticChars } = await row.run();
      expect(staticChars).toBeLessThanOrEqual(CLAIRE_STATIC_INSTRUCTION_BUDGET);
    });
  }

  it("reports the maximum static-character count across all configurations", async () => {
    const counts: Array<{ name: string; staticChars: number }> = [];
    for (const row of matrix) {
      const { staticChars } = await row.run();
      counts.push({ name: row.name, staticChars });
    }
    const max = Math.max(...counts.map(row => row.staticChars));
    expect(max).toBeLessThanOrEqual(CLAIRE_STATIC_INSTRUCTION_BUDGET);
    expect(counts).toHaveLength(6);
  });

  it("delivery rules remain last on the voice follow-up path, including both conditionals", async () => {
    const { system } = await followUpSize({
      surface: "voice",
      retrievedEvidence: RETRIEVED_EVIDENCE,
      missionSalesBrief: MISSION_SALES_BRIEF,
    });
    expect(system.endsWith(VOICE_NATIVE_ANSWER_GUIDANCE)).toBe(true);
  });

  it("desktop follow-up still omits voice delivery rules", async () => {
    const { system } = await followUpSize({ surface: "desktop" });
    expect(system).not.toContain("DELIVERY RULES");
  });

  it("offer, truth, judgment, history, and retrieval contracts survive the diet", async () => {
    const { system } = await followUpSize({ retrievedEvidence: RETRIEVED_EVIDENCE });
    expect(system).toContain(GOLDLINE_OFFER_CONTEXT);
    expect(system).toMatch(/business-specific claims[^.]*must be grounded[^.]*fact inventory[^.]*unknown/i);
    expect(system).toContain("never asserted as a fact about this business");
    expect(system).toContain("A prior Claire turn is conversation history, not verified truth");
    expect(system).toMatch(/still answer any judgment asked/i);
    expect(system).toMatch(/say you don't know it/i);
  });

  it("MissionSalesBrief authority survives when a brief is present", async () => {
    const { system } = await followUpSize({ missionSalesBrief: MISSION_SALES_BRIEF });
    expect(system).toMatch(/one authoritative sales strategy/i);
    expect(system).toMatch(/its unknowns.*never known facts/i);
  });

  it("keeps the strong temporal-authority semantics in every static prompt", async () => {
    expect(CLAIRE_TEMPORAL_AUTHORITY_INSTRUCTION).toContain("sole temporal authority");
    expect(CLAIRE_TEMPORAL_AUTHORITY_INSTRUCTION).toContain("Ignore any ambient model/provider/server notion of the current time");
    expect(CLAIRE_TEMPORAL_AUTHORITY_INSTRUCTION).toContain("Never override the supplied clock");
    expect((await followUpSize({})).system).toContain(CLAIRE_TEMPORAL_AUTHORITY_INSTRUCTION);
    expect((await openingSize({})).system).toContain(CLAIRE_TEMPORAL_AUTHORITY_INSTRUCTION);
  });

  it("counts the capability briefing as static instruction, not user JSON", async () => {
    for (const run of [await followUpSize({}), await openingSize({})]) {
      expect(run.size.sections.some(section => section.label === "capability_briefing")).toBe(true);
      expect(run.system).toContain("Supported:");
    }
  });

  it("evidence-present prompt never claims that no evidence exists", async () => {
    const { system } = await followUpSize({ retrievedEvidence: RETRIEVED_EVIDENCE });
    expect(system).not.toMatch(/no evidence/i);
    expect(system).toMatch(/use the supplied evidence for specific business facts/i);
    expect(system).toMatch(/still answer any judgment asked/i);
  });

  it("evidence-absent prompt requires truthful unknown handling and keeps the judgment half", async () => {
    const { system } = await followUpSize({});
    expect(system).toMatch(/no evidence supplied/i);
    expect(system).toMatch(/say you don't know it/i);
    expect(system).toMatch(/still answer any judgment asked/i);
  });

  it("does not instruct Claire in internal vocabulary", async () => {
    for (const evidence of [undefined, RETRIEVED_EVIDENCE]) {
      const { system } = await followUpSize(evidence ? { retrievedEvidence: evidence } : {});
      expect(system).not.toContain("unsupported_fact");
      expect(system).not.toContain("retrievedEvidence");
    }
  });
});
