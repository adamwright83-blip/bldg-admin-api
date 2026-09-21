import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ClaireDriveContext } from "./contextAssembler";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import {
  AUTHORED_NARRATIVE_MATERIAL_RULE,
  claireDeliveryForOccurrence,
  claireProviderMetadataWithNarrative,
  narrativeClaireSpeechMetadata,
  narratorPromptSectionForClaire,
} from "./narratorPresentationConsumer";
import {
  SPEECH_DELIVERY,
  isConfirmedHeardClaireSpeech,
} from "./conversation/speechDelivery";
import { buildClaireVerifiedFactInventory } from "./verifiedFactInventoryFromContext";
import { runClaireTurn } from "./turn/claireTurn";
import type { NarrativePresentationPlan } from "../narratorOs/presentationPlan";
import type { AuthoredReactionReceipt } from "../narratorOs/narrativeReadModels";

const receipt = {
  beatId: "M04",
  ledgerEntryId: "occ-permitted",
  occurredAt: "2026-09-21T00:00:00.000Z",
  knowledgeMutationRefs: [
    { plane: "CLAIRE" as const, factId: "authored_fact", op: "learn" as const },
  ],
  stateMutationRefs: [],
  characters: ["Claire"],
  playerVisible: true,
} satisfies AuthoredReactionReceipt;

function plan(claire: NarrativePresentationPlan["claire"]): NarrativePresentationPlan {
  return {
    occurrenceLedgerEntryId: "occ-permitted",
    beatId: "M04",
    occurredAt: "2026-09-21T00:00:00.000Z",
    presentationId: "presentation:occ-permitted",
    player: { maySurface: true, title: "HELD" },
    claire,
    authoredReaction: receipt,
    authoredSourceRef: "authored-test-ref",
  };
}

const silent = plan({ knows: true, mayDisclose: false, maySpeak: false });
const permitted = plan({ knows: true, mayDisclose: true, maySpeak: true });

const context = {
  phase: "pre_drive",
  generatedAt: "2026-09-21T12:00:00.000Z",
  businessDate: "2026-09-21",
  actorId: "operator-1",
  truthLaw: "game_projection_never_creates_business_truth",
  nextFixedCommitment: null,
  blockers: [],
  relevantTimeline: [],
  mission: null,
} as ClaireDriveContext;

describe("Claire consumes Narrator presentation without making it business truth", () => {
  it("fails closed unless knowledge and authored disclosure both permit speech", () => {
    expect(narratorPromptSectionForClaire(null)).toBeNull();
    expect(narratorPromptSectionForClaire(silent)).toBeNull();
    expect(
      narratorPromptSectionForClaire(
        plan({ knows: false, mayDisclose: true, maySpeak: true })
      )
    ).toBeNull();
    const section = narratorPromptSectionForClaire(permitted);
    expect(section).toContain(AUTHORED_NARRATIVE_MATERIAL_RULE);
    expect(section).toContain("CLAIRE:authored_fact:learn");
    expect(section).toContain("Authored title: HELD.");
    expect(section).not.toMatch(/courtyard|smiled|whispered/i);
    expect(buildClaireVerifiedFactInventory(context).toPromptSection()).not.toContain(
      "HELD"
    );
    expect(buildClaireVerifiedFactInventory(context).toPromptSection()).not.toContain(
      AUTHORED_NARRATIVE_MATERIAL_RULE
    );
  });

  it("feeds the guarded generation path a separated section and leaves queued speech unheard", async () => {
    const invokeText = vi.fn().mockResolvedValue("Pace the afternoon around the real stops.");
    const section = narratorPromptSectionForClaire(permitted);
    const reply = await answerClairePreDriveFollowUp(
      {
        tenantId: "tenant-h",
        utterance: "How should I think about pacing the rest of the day?",
        brief: null,
        context,
        narratorPromptSection: section,
      },
      { invokeText, biographyVerifier: async () => true }
    );
    const system = invokeText.mock.calls[0][0].messages[0].content as string;
    const user = invokeText.mock.calls[0][0].messages.at(-1).content as string;
    expect(system).toContain(AUTHORED_NARRATIVE_MATERIAL_RULE);
    expect(system).toContain("VERIFIED FACT INVENTORY");
    expect(user).not.toContain(AUTHORED_NARRATIVE_MATERIAL_RULE);
    expect(system.indexOf(AUTHORED_NARRATIVE_MATERIAL_RULE)).toBeGreaterThan(
      system.indexOf("VERIFIED FACT INVENTORY")
    );
    expect(reply).toBe("Pace the afternoon around the real stops.");

    const metadata = claireProviderMetadataWithNarrative(
      narrativeClaireSpeechMetadata(permitted)
    );
    expect(metadata.speechDelivery).toBe(SPEECH_DELIVERY.GENERATED_QUEUED);
    expect(metadata.heardConfirmed).toBe(false);
    expect(isConfirmedHeardClaireSpeech(metadata)).toBe(false);
    expect(metadata.narratorOccurrenceLedgerId).toBe("occ-permitted");
    expect(metadata.narratorBeatId).toBe("M04");
    expect(metadata.narrativePresentationId).toBe("presentation:occ-permitted");
    expect(claireDeliveryForOccurrence(metadata)).toMatchObject({
      occurrenceLedgerEntryId: "occ-permitted",
      speechDelivery: "generated_queued",
      heardConfirmed: false,
    });
  });

  it("runClaireTurn does not decide fiction and does not confirm hearing", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/claire/turn/claireTurn.ts"),
      "utf8"
    );
    expect(source).not.toMatch(
      /advanceNarratorAfterVerifiedOutcome|orchestrateSelectedBeatReaction/
    );
    const seen: Array<string | null | undefined> = [];
    const result = await runClaireTurn(
      {
        tenantId: "tenant-h",
        operatorUserId: "op-h",
        dayDirectorActorId: "actor-h",
        utterance: "How should I think about pacing the rest of the day?",
        surface: "text",
        state: {},
        context,
        conversationKey: "thread-h",
        narrativePresentation: permitted,
      },
      {
        doctrineTurn: async () => null,
        commitment: async () => ({ kind: "not_applicable" }) as never,
        followUp: async input => {
          seen.push(input.narratorPromptSection);
          return "Pace the afternoon around the real stops.";
        },
        accounts: async () => [],
        dayWork: async () => {
          throw new Error("no day work");
        },
        unpaid: async () => [],
        searchMemory: async () => [],
        business: { plan: async () => null, runQuery: async () => ({ status: "unsupported" }) as never },
        now: () => new Date("2026-09-21T15:00:00.000Z"),
        timeZone: () => "America/Los_Angeles",
      }
    );
    expect(seen).toEqual([narratorPromptSectionForClaire(permitted)]);
    expect(result.narrativeSpeech?.speechDelivery).toBe("generated_queued");
    expect(result.narrativeSpeech?.heardConfirmed).toBe(false);
    expect(isConfirmedHeardClaireSpeech(result.narrativeSpeech)).toBe(false);

    const silentTurn = await runClaireTurn(
      {
        tenantId: "tenant-h",
        operatorUserId: "op-h",
        dayDirectorActorId: "actor-h",
        utterance: "How should I think about pacing the rest of the day?",
        surface: "text",
        state: {},
        context,
        conversationKey: "thread-h-silent",
        narrativePresentation: silent,
      },
      {
        doctrineTurn: async () => null,
        commitment: async () => ({ kind: "not_applicable" }) as never,
        followUp: async input => {
          seen.push(input.narratorPromptSection);
          return "Pace the afternoon around the real stops.";
        },
        accounts: async () => [],
        now: () => new Date("2026-09-21T15:00:00.000Z"),
        timeZone: () => "America/Los_Angeles",
      }
    );
    expect(silentTurn.narrativeSpeech).toBeUndefined();
    expect(seen.at(-1)).toBeNull();
  });
});
