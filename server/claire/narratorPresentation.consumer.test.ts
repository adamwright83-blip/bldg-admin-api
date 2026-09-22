import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ClaireDriveContext } from "./contextAssembler";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import {
  AUTHORED_NARRATIVE_MATERIAL_RULE,
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
import {
  isTrustedNarrativePresentationPlan,
  rememberNarrativePresentationPlanForTests,
  type NarrativePresentationPlan,
} from "../narratorOs/presentationPlan";
import type { AuthoredReactionReceipt } from "../narratorOs/narrativeReadModels";

const TITLE_LORE = "THE COURTYARD TITLE IS NOT A CLAIRE FACT";
const HIDDEN_STATE_KEY = "hidden_state_key";
const HIDDEN_STATE_VALUE = "secret-state-value";
const PERMITTED_FACT = "permitted_claire_fact";

const receipt = {
  beatId: "M04",
  ledgerEntryId: "occ-permitted",
  occurredAt: "2026-09-21T00:00:00.000Z",
  knowledgeMutationRefs: [
    { plane: "CLAIRE" as const, factId: PERMITTED_FACT, op: "learn" as const },
    { plane: "PLAYER" as const, factId: "player_only_fact", op: "learn" as const },
  ],
  stateMutationRefs: [{ key: HIDDEN_STATE_KEY, value: HIDDEN_STATE_VALUE }],
  characters: ["Claire"],
  playerVisible: true,
} satisfies AuthoredReactionReceipt;

function forgedPlan(
  claire: NarrativePresentationPlan["claire"]
): NarrativePresentationPlan {
  return {
    occurrenceLedgerEntryId: "occ-permitted",
    beatId: "M04",
    occurredAt: "2026-09-21T00:00:00.000Z",
    presentationId: "presentation:occ-permitted",
    player: { maySurface: true, title: TITLE_LORE },
    claire,
    authoredReaction: receipt,
    authoredSourceRef: "authored-test-ref",
  };
}

const forgedPermitted = forgedPlan({
  knows: true,
  mayDisclose: true,
  maySpeak: true,
});
const trustedPermitted = rememberNarrativePresentationPlanForTests(forgedPermitted);
const trustedSilent = rememberNarrativePresentationPlanForTests(
  forgedPlan({ knows: true, mayDisclose: false, maySpeak: false })
);

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

const BUSINESS_ANSWER = "Pace the afternoon around the real stops.";
const GUARD_REPLACEMENT = "Give me a second—ask me that once more.";

function turnDeps(
  followUp: (input: { narratorPromptSection?: string | null }) => Promise<string>
) {
  return {
    doctrineTurn: async () => null,
    commitment: async () => ({ kind: "not_applicable" }) as never,
    followUp,
    accounts: async () => [],
    dayWork: async () => {
      throw new Error("no day work");
    },
    unpaid: async () => [],
    searchMemory: async () => [],
    business: {
      plan: async () => null,
      runQuery: async () => ({ status: "unsupported" }) as never,
    },
    now: () => new Date("2026-09-21T15:00:00.000Z"),
    timeZone: () => "America/Los_Angeles",
  };
}

describe("Claire consumes Narrator presentation without making it business truth", () => {
  it("rejects a forged plan even when every visible field matches a trusted one", () => {
    expect(isTrustedNarrativePresentationPlan(forgedPermitted)).toBe(false);
    expect(isTrustedNarrativePresentationPlan({ ...trustedPermitted })).toBe(false);
    expect(
      isTrustedNarrativePresentationPlan(JSON.parse(JSON.stringify(trustedPermitted)))
    ).toBe(false);
    expect(narratorPromptSectionForClaire(forgedPermitted)).toBeNull();
    expect(narratorPromptSectionForClaire({ ...trustedPermitted })).toBeNull();
    expect(narrativeClaireSpeechMetadata(forgedPermitted)).toBeNull();
    expect(narrativeClaireSpeechMetadata(trustedPermitted)).toBeNull();
    const metadata = claireProviderMetadataWithNarrative({
      narratorOccurrenceLedgerId: forgedPermitted.occurrenceLedgerEntryId,
      narratorBeatId: forgedPermitted.beatId,
      narrativePresentationId: forgedPermitted.presentationId,
      speechDelivery: SPEECH_DELIVERY.GENERATED_QUEUED,
      heardConfirmed: false,
    });
    expect(metadata.speechDelivery).toBe(SPEECH_DELIVERY.GENERATED_QUEUED);
    expect(metadata.heardConfirmed).toBe(false);
    expect(metadata.narratorOccurrenceLedgerId).toBeUndefined();
    expect(isConfirmedHeardClaireSpeech(metadata)).toBe(false);
  });

  it("puts only the permitted Claire fact in the prompt, not the title or hidden state", () => {
    expect(narratorPromptSectionForClaire(null)).toBeNull();
    expect(narratorPromptSectionForClaire(trustedSilent)).toBeNull();
    const section = narratorPromptSectionForClaire(trustedPermitted);
    expect(section).toContain(AUTHORED_NARRATIVE_MATERIAL_RULE);
    expect(section).toContain(`learn ${PERMITTED_FACT}`);
    expect(section).not.toContain(TITLE_LORE);
    expect(section).not.toContain(HIDDEN_STATE_KEY);
    expect(section).not.toContain(HIDDEN_STATE_VALUE);
    expect(section).not.toContain("player_only_fact");
    expect(section).not.toContain("Authored title");
    expect(section).not.toMatch(/courtyard|smiled|whispered/i);
    expect(buildClaireVerifiedFactInventory(context).toPromptSection()).not.toContain(
      TITLE_LORE
    );
    expect(buildClaireVerifiedFactInventory(context).toPromptSection()).not.toContain(
      AUTHORED_NARRATIVE_MATERIAL_RULE
    );
  });

  it("supplies trusted context to generation without treating the answer as narrative speech", async () => {
    const invokeText = vi.fn().mockResolvedValue(BUSINESS_ANSWER);
    const section = narratorPromptSectionForClaire(trustedPermitted);
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
    expect(system).toContain(PERMITTED_FACT);
    expect(system).not.toContain(TITLE_LORE);
    expect(system).not.toContain(HIDDEN_STATE_VALUE);
    expect(system).toContain("VERIFIED FACT INVENTORY");
    expect(user).not.toContain(AUTHORED_NARRATIVE_MATERIAL_RULE);
    expect(reply).toBe(BUSINESS_ANSWER);
  });

  it("does not associate an unrelated answer or a guard replacement with the occurrence", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "server/claire/turn/claireTurn.ts"),
      "utf8"
    );
    expect(source).not.toMatch(
      /advanceNarratorAfterVerifiedOutcome|orchestrateSelectedBeatReaction|narrativeClaireSpeechMetadata/
    );
    const seen: Array<string | null | undefined> = [];
    const unrelated = await runClaireTurn(
      {
        tenantId: "tenant-h",
        operatorUserId: "op-h",
        dayDirectorActorId: "actor-h",
        utterance: "How should I think about pacing the rest of the day?",
        surface: "text",
        state: {},
        context,
        conversationKey: "thread-h",
        narrativePresentation: trustedPermitted,
      },
      turnDeps(async input => {
        seen.push(input.narratorPromptSection);
        return BUSINESS_ANSWER;
      })
    );
    expect(seen).toEqual([narratorPromptSectionForClaire(trustedPermitted)]);
    expect(unrelated.speak).toBe(BUSINESS_ANSWER);
    expect(unrelated.narratorContextSupplied).toBe(true);
    expect(unrelated.narrativeSpeech).toBeUndefined();
    expect(isConfirmedHeardClaireSpeech(unrelated.narrativeSpeech)).toBe(false);

    const replaced = await runClaireTurn(
      {
        tenantId: "tenant-h",
        operatorUserId: "op-h",
        dayDirectorActorId: "actor-h",
        utterance: "How should I think about pacing the rest of the day?",
        surface: "text",
        state: {},
        context,
        conversationKey: "thread-h-guard",
        narrativePresentation: trustedPermitted,
      },
      turnDeps(async () => GUARD_REPLACEMENT)
    );
    expect(replaced.speak).toBe(GUARD_REPLACEMENT);
    expect(replaced.narratorContextSupplied).toBe(true);
    expect(replaced.narrativeSpeech).toBeUndefined();

    const forgedTurn = await runClaireTurn(
      {
        tenantId: "tenant-h",
        operatorUserId: "op-h",
        dayDirectorActorId: "actor-h",
        utterance: "How should I think about pacing the rest of the day?",
        surface: "text",
        state: {},
        context,
        conversationKey: "thread-h-forged",
        narrativePresentation: forgedPermitted,
      },
      turnDeps(async input => {
        seen.push(input.narratorPromptSection);
        return BUSINESS_ANSWER;
      })
    );
    expect(seen.at(-1)).toBeNull();
    expect(forgedTurn.narrativeSpeech).toBeUndefined();
    expect(forgedTurn.narratorContextSupplied).toBeUndefined();
  });
});
