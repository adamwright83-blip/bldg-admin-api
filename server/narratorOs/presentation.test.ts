import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { NarrativeBeatId } from "../../shared/narratorOs/contracts";
import { AUTHORED_NARRATIVE_FACTS } from "./authoredNarrativeFacts";
import { advanceNarratorAfterVerifiedOutcome } from "./advanceAfterVerifiedOutcome";
import { initNarratorOperator } from "./init";
import { createInMemoryNarratorStore } from "./memoryStore";
import { narrativePresentationMemory } from "./presentationMemory";
import { isAuthoritativeNarratorSnapshot } from "./narratorSnapshotAttestation";
import {
  authoredBeatMayPresent,
  deriveNarrativePresentationPlan,
  isTrustedNarrativePresentationPlan,
} from "./presentationPlan";
import { playerPresentationPayload } from "./playerPresentation";
import {
  PRESENTATION_RECEIPT_STATUSES,
  createInMemoryNarratorPresentationStore,
  preparePlayerPresentationForOccurrence,
  renderPlayerPresentationToSurface,
} from "./presentationStore";
import { AUTHORED_BEATS, getBeat } from "./registry";
import {
  EMPTY_KNOWLEDGE,
  SEEDED_NARRATIVE_STATE,
  cloneKnowledge,
  type NarratorSnapshot,
  type NarratorStore,
} from "./store";
import { CLAIRE_LIVED_BIO_FACTS, NARRATOR_LIVED_BIO_VERSION } from "./livedBio";
import { NARRATOR_WORLD_TRUTH_VERSION, WORLD_TRUTH_FACTS } from "./worldTruth";
import { issueVerifiedGoldlineReceiptForTests } from "./verifiedGoldlineReceipt.testSupport";
import type { VerifiedGoldlineReceipt } from "./verifiedGoldlineReceipt";
import { REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS } from "../goldlineVerification/supportedOutcomes";

const scope = { tenantId: "t-h", operatorUserId: "op-h" };
const NOW_MS = Date.parse("2026-09-21T00:00:00Z");
const NOW_ISO = "2026-09-21T00:00:00.000Z";
const MONDAY_MS = Date.parse("2026-09-14T12:00:00Z");
const TUESDAY_MS = Date.parse("2026-09-15T12:00:00Z");

function issueReceipt(
  outcomeId: string,
  extra?: { receiptId?: string; targetId?: string; occurredAtMs?: number }
): VerifiedGoldlineReceipt {
  return issueVerifiedGoldlineReceiptForTests({
    receiptId: extra?.receiptId ?? `receipt:${outcomeId}`,
    tenantId: scope.tenantId,
    operatorUserId: scope.operatorUserId,
    outcomeId,
    evidenceClass: "operator_attested",
    evidenceRef: {
      sourceType: "field_visit",
      sourceReference: extra?.receiptId ?? `receipt:${outcomeId}`,
      classification: "operator_attested",
    },
    targetRef: extra?.targetId
      ? { kind: "goldline_target", id: extra.targetId }
      : null,
    occurredAtMs: extra?.occurredAtMs ?? 1,
  });
}

async function seeded() {
  const store = createInMemoryNarratorStore();
  await initNarratorOperator(store, scope);
  return store;
}

async function withState(
  store: NarratorStore,
  values: Record<string, string>
) {
  const snapshot = await store.load(scope);
  if (!snapshot) throw new Error("missing snapshot");
  await store.replaceNarrativeState(scope, {
    ...snapshot.narrativeState,
    values: { ...snapshot.narrativeState.values, ...values },
  });
}

function goldlineCount(snapshot: NarratorSnapshot): number {
  return snapshot.ledger.filter(entry => entry.kind === "VERIFIED_GOLDLINE_OUTCOME")
    .length;
}

describe("Narrator OS slice H — presentation boundary", () => {
  it("player-visible committed M04 yields a presentation tied to that occurrence", async () => {
    const store = await seeded();
    const before = await store.load(scope);
    const result = await advanceNarratorAfterVerifiedOutcome({
      store,
      scope,
      verifiedGoldline: [
        issueReceipt("kept_promised_send_visit_or_call", { receiptId: "m04-keep" }),
      ],
      nowMs: NOW_MS,
      nowIso: NOW_ISO,
    });
    expect(result.advanced).toBe(true);
    expect(result.narrationFailed).toBe(false);
    expect(result.presentation?.beatId).toBe("M04");
    expect(result.presentation?.occurredAt).toBe(NOW_ISO);
    expect(result.presentation?.player.maySurface).toBe(true);
    expect(result.presentation?.player.title).toBe("HELD");
    expect(result.playerPayload).toEqual({
      beatId: "M04",
      title: "HELD",
      occurredAt: NOW_ISO,
      characters: [...getBeat("M04").characters],
      occurrenceLedgerEntryId: result.presentation?.occurrenceLedgerEntryId,
      authoredSourceRef: getBeat("M04").authoredSourceRef,
      reaction: {
        knowledgeMutationRefs: [],
        stateMutationRefs: [{ key: "act_i", value: "complete" }],
      },
    });
    const loaded = await store.load(scope);
    expect(loaded?.ledger.filter(entry => entry.kind === "FIRED_AUTHORED_BEAT")).toHaveLength(1);
    expect(loaded?.ledger[0]?.id).toBe(result.presentation?.occurrenceLedgerEntryId);
    expect(goldlineCount(loaded!)).toBe(0);
    expect(loaded?.worldTruth).toEqual(before?.worldTruth);
    expect(loaded?.livedBio).toEqual(before?.livedBio);
    expect(JSON.stringify(result.playerPayload)).not.toMatch(
      /courtyard|smiled|whispered|villain|she looked/i
    );
    expect(result.playerPayload).not.toHaveProperty("prose");
    expect(result.playerPayload).not.toHaveProperty("scene");
    expect(result.playerPayload).not.toHaveProperty("dialogue");
  });

  it("M01, M03, and M04 do not teach Claire or permit Claire speech", async () => {
    const store = await seeded();
    const m01 = await advanceNarratorAfterVerifiedOutcome({
      store,
      scope,
      verifiedGoldline: [issueReceipt("physical_first_visit", { receiptId: "m01" })],
      nowMs: NOW_MS,
      nowIso: NOW_ISO,
    });
    expect(m01.presentation?.player.maySurface).toBe(true);
    expect(m01.presentation?.player.title).toBe("FIRST LIGHT");
    expect(m01.presentation?.claire).toEqual({
      knows: false,
      mayDisclose: false,
      maySpeak: false,
    });
    expect(m01.playerPayload?.beatId).toBe("M01");
    const afterM01 = await store.load(scope);
    expect(afterM01?.knowledge.planes.CLAIRE.knownFactIds).toEqual([]);
    expect(afterM01?.knowledge.planes.PLAYER.knownFactIds).toEqual([]);

    const m04 = await advanceNarratorAfterVerifiedOutcome({
      store,
      scope,
      verifiedGoldline: [
        issueReceipt("physical_first_visit", { receiptId: "m01" }),
        issueReceipt("kept_promised_send_visit_or_call", { receiptId: "m04" }),
      ],
      nowMs: NOW_MS,
      nowIso: "2026-09-21T01:00:00.000Z",
    });
    expect(m04.advanced).toBe(true);
    expect(m04.presentation?.beatId).toBe("M04");
    expect(m04.presentation?.claire.knows).toBe(false);
    expect(m04.presentation?.claire.maySpeak).toBe(false);
    expect(getBeat("M04").characters).toContain("Claire");
    expect(getBeat("M04").disclosureRules).toEqual([]);
    const after = await store.load(scope);
    expect(after?.knowledge.planes.CLAIRE.knownFactIds).toEqual([]);
  });

  it("keeps repeat M03 occurrences and their presentation states separate", async () => {
    const store = await seeded();
    const presentations = createInMemoryNarratorPresentationStore();
    const firstReceipts = [
      issueReceipt("silence_eligible_for_retry", {
        receiptId: "m03-arm",
        targetId: "target-h",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("legitimate_second_site_visit", {
        receiptId: "m03-return",
        targetId: "target-h",
        occurredAtMs: TUESDAY_MS,
      }),
    ];
    const first = await advanceNarratorAfterVerifiedOutcome({
      store,
      scope,
      verifiedGoldline: firstReceipts,
      nowMs: NOW_MS,
      nowIso: NOW_ISO,
    });
    expect(first.presentation?.beatId).toBe("M03");
    expect(first.presentation?.claire).toEqual({
      knows: false,
      mayDisclose: false,
      maySpeak: false,
    });
    expect(first.playerPayload?.title).toBe("AFTER NO");
    const second = await advanceNarratorAfterVerifiedOutcome({
      store,
      scope,
      verifiedGoldline: [
        ...firstReceipts,
        issueReceipt("silence_eligible_for_retry", {
          receiptId: "m03-arm-2",
          targetId: "target-h",
          occurredAtMs: Date.parse("2026-09-16T12:00:00Z"),
        }),
        issueReceipt("legitimate_second_site_visit", {
          receiptId: "m03-return-2",
          targetId: "target-h",
          occurredAtMs: Date.parse("2026-09-17T12:00:00Z"),
        }),
      ],
      nowMs: NOW_MS,
      nowIso: "2026-09-22T00:00:00.000Z",
    });
    expect(second.presentation?.beatId).toBe("M03");
    expect(second.presentation?.occurrenceLedgerEntryId).not.toBe(
      first.presentation?.occurrenceLedgerEntryId
    );
    const snapshot = (await store.load(scope))!;
    expect(await presentations.loadForOperator(scope)).toEqual([]);
    const prepared = await preparePlayerPresentationForOccurrence({
      presentationStore: presentations,
      snapshot,
      occurrenceLedgerEntryId: first.presentation!.occurrenceLedgerEntryId,
      nowIso: NOW_ISO,
    });
    expect(prepared?.receipt.status).toBe("prepared");
    const again = await preparePlayerPresentationForOccurrence({
      presentationStore: presentations,
      snapshot,
      occurrenceLedgerEntryId: first.presentation!.occurrenceLedgerEntryId,
      nowIso: "2026-09-23T00:00:00.000Z",
    });
    expect(again?.receipt.id).toBe(prepared?.receipt.id);
    expect(await presentations.loadForOperator(scope)).toHaveLength(1);
    const memory = narrativePresentationMemory({
      snapshot,
      presentationReceipts: await presentations.loadForOperator(scope),
    });
    expect(memory.occurrences.map(row => row.beatId)).toEqual(["M03", "M03"]);
    expect(memory.occurrences[0]?.ledgerEntryId).not.toBe(
      memory.occurrences[1]?.ledgerEntryId
    );
    expect(memory.occurrences[0]?.presentationStatus).toBe("prepared");
    expect(memory.occurrences[1]?.presentationStatus).toBeNull();
    expect(memory.firedAuthoredBeats[0]).not.toHaveProperty("presented");
    const claimed = narrativePresentationMemory({
      snapshot,
      presentationReceipts: await presentations.loadForOperator(scope),
      claireDeliveries: [
        {
          occurrenceLedgerEntryId: memory.occurrences[0]!.ledgerEntryId,
          speechDelivery: "generated_queued",
          heardConfirmed: true,
        },
      ],
    });
    expect(claimed.occurrences[0]?.claireSpeechDelivery).toBeNull();
    expect(claimed.occurrences[0]?.claireHeardConfirmed).toBeNull();
  });

  it("C-08 teaches Claire the authored fact and still refuses Claire speech", async () => {
    const store = await seeded();
    await withState(store, {
      [AUTHORED_NARRATIVE_FACTS.reservedCorePreserved]: "true",
      [AUTHORED_NARRATIVE_FACTS.lot17kPhysicallyInHand]: "true",
    });
    const result = await advanceNarratorAfterVerifiedOutcome({
      store,
      scope,
      verifiedGoldline: [
        issueReceipt("unrelated_verified_marker", { receiptId: "c08-marker" }),
      ],
      nowMs: NOW_MS,
      nowIso: NOW_ISO,
    });
    expect(result.presentation?.beatId).toBe("C-08");
    expect(result.presentation?.claire.knows).toBe(true);
    expect(result.presentation?.claire.mayDisclose).toBe(false);
    expect(result.presentation?.claire.maySpeak).toBe(false);
    expect(result.playerPayload?.title).toBe("STRONG COMPARISON");
    const loaded = await store.load(scope);
    expect(loaded?.knowledge.planes.CLAIRE.knownFactIds).toEqual([
      "c08_comparison_occurred",
    ]);
    expect(getBeat("C-08").disclosureRules).toEqual([]);
  });

  it("C-06 withheld does not become a player presentation", async () => {
    const store = await seeded();
    const snapshot = await store.load(scope);
    const entry = await store.appendLedger(scope, {
      kind: "FIRED_AUTHORED_BEAT",
      beatId: getBeat("C-06").id,
      goldlineOutcomeId: null,
      offscreen: false,
      playerVisible: true,
      evidenceRef: null,
      occurredAt: NOW_ISO,
      idempotencyKey: "forged-c06-visible-flag",
    });
    const loaded = (await store.load(scope))!;
    const plan = deriveNarrativePresentationPlan(loaded, entry.id);
    expect(getBeat("C-06").playerVisibility).toBe(false);
    expect(plan?.player.maySurface).toBe(false);
    expect(playerPresentationPayload(plan)).toBeNull();
    const presentations = createInMemoryNarratorPresentationStore();
    expect(
      await preparePlayerPresentationForOccurrence({
        presentationStore: presentations,
        snapshot: loaded,
        occurrenceLedgerEntryId: entry.id,
        nowIso: NOW_ISO,
      })
    ).toBeNull();
    expect(await presentations.loadForOperator(scope)).toEqual([]);
    expect(loaded.knowledge).toEqual(snapshot?.knowledge);
  });

  it("derives a trusted plan only from an attested store snapshot", async () => {
    const fabricated: NarratorSnapshot = {
      tenantId: scope.tenantId,
      operatorUserId: scope.operatorUserId,
      worldTruth: WORLD_TRUTH_FACTS,
      livedBio: CLAIRE_LIVED_BIO_FACTS,
      knowledge: cloneKnowledge(EMPTY_KNOWLEDGE),
      narrativeState: {
        values: { ...SEEDED_NARRATIVE_STATE.values },
        closedForwardPaths: [...SEEDED_NARRATIVE_STATE.closedForwardPaths],
        holdOpenedAtMs: { ...SEEDED_NARRATIVE_STATE.holdOpenedAtMs },
      },
      ledger: [
        {
          id: "fabricated-m04",
          tenantId: scope.tenantId,
          operatorUserId: scope.operatorUserId,
          kind: "FIRED_AUTHORED_BEAT",
          beatId: getBeat("M04").id,
          goldlineOutcomeId: null,
          offscreen: false,
          playerVisible: true,
          evidenceRef: null,
          occurredAt: NOW_ISO,
          idempotencyKey: "beat:M04:once",
        },
      ],
      catalogVersion: {
        worldTruth: NARRATOR_WORLD_TRUTH_VERSION,
        livedBio: NARRATOR_LIVED_BIO_VERSION,
      },
    };
    expect(getBeat("M04").eligibilityDefinition).toBe("COMPLETE");
    expect(isAuthoritativeNarratorSnapshot(fabricated)).toBe(false);
    expect(deriveNarrativePresentationPlan(fabricated, "fabricated-m04")).toBeNull();
    expect(
      isTrustedNarrativePresentationPlan(
        deriveNarrativePresentationPlan(fabricated, "fabricated-m04")
      )
    ).toBe(false);

    const store = await seeded();
    const fired = await advanceNarratorAfterVerifiedOutcome({
      store,
      scope,
      verifiedGoldline: [
        issueReceipt("kept_promised_send_visit_or_call", {
          receiptId: "m04-attested",
        }),
      ],
      nowMs: NOW_MS,
      nowIso: NOW_ISO,
    });
    const loaded = await store.load(scope);
    const occurrenceId = fired.presentation?.occurrenceLedgerEntryId;
    expect(occurrenceId).toBeTruthy();
    expect(isAuthoritativeNarratorSnapshot(loaded)).toBe(true);
    const trusted = deriveNarrativePresentationPlan(loaded!, occurrenceId!);
    expect(trusted?.beatId).toBe("M04");
    expect(trusted?.player.maySurface).toBe(true);
    expect(isTrustedNarrativePresentationPlan(trusted)).toBe(true);

    const spread = {
      ...loaded!,
      ledger: [...loaded!.ledger],
      catalogVersion: { ...loaded!.catalogVersion },
      narrativeState: {
        ...loaded!.narrativeState,
        values: { ...loaded!.narrativeState.values },
      },
    };
    const cloned = JSON.parse(JSON.stringify(loaded)) as NarratorSnapshot;
    expect(isAuthoritativeNarratorSnapshot(spread)).toBe(false);
    expect(isAuthoritativeNarratorSnapshot(cloned)).toBe(false);
    expect(deriveNarrativePresentationPlan(spread, occurrenceId!)).toBeNull();
    expect(deriveNarrativePresentationPlan(cloned, occurrenceId!)).toBeNull();
    expect(isTrustedNarrativePresentationPlan(trusted)).toBe(true);
  });

  it("rejects fabricated occurrences, unknown beats, and OPEN or INCOMPLETE beats", async () => {
    const store = await seeded();
    const empty = (await store.load(scope))!;
    expect(deriveNarrativePresentationPlan(empty, "fabricated-occurrence")).toBeNull();
    const forged = await store.appendLedger(scope, {
      kind: "FIRED_AUTHORED_BEAT",
      beatId: "NOT-A-BEAT" as NarrativeBeatId,
      goldlineOutcomeId: null,
      offscreen: false,
      playerVisible: true,
      evidenceRef: null,
      occurredAt: NOW_ISO,
      idempotencyKey: "forged-beat",
    });
    const withFake = (await store.load(scope))!;
    expect(deriveNarrativePresentationPlan(withFake, forged.id)).toBeNull();
    const incomplete = await store.appendLedger(scope, {
      kind: "FIRED_AUTHORED_BEAT",
      beatId: getBeat("M02").id,
      goldlineOutcomeId: null,
      offscreen: false,
      playerVisible: true,
      evidenceRef: null,
      occurredAt: NOW_ISO,
      idempotencyKey: "forged-m02",
    });
    const withIncomplete = (await store.load(scope))!;
    expect(getBeat("M02").eligibilityDefinition).toBe("INCOMPLETE");
    expect(deriveNarrativePresentationPlan(withIncomplete, incomplete.id)).toBeNull();
    expect(
      authoredBeatMayPresent({
        canonStatus: "OPEN",
        eligibilityDefinition: "COMPLETE",
      })
    ).toBe(false);
    expect(
      AUTHORED_BEATS.filter(beat => beat.canonStatus === "OPEN")
    ).toEqual([]);
    const presentations = createInMemoryNarratorPresentationStore();
    expect(
      await preparePlayerPresentationForOccurrence({
        presentationStore: presentations,
        snapshot: withIncomplete,
        occurrenceLedgerEntryId: incomplete.id,
        nowIso: NOW_ISO,
      })
    ).toBeNull();
    expect(await presentations.loadForOperator(scope)).toEqual([]);
  });

  it("does not write a presentation receipt before the presentation boundary", async () => {
    const store = await seeded();
    const presentations = createInMemoryNarratorPresentationStore();
    const result = await advanceNarratorAfterVerifiedOutcome({
      store,
      scope,
      verifiedGoldline: [
        issueReceipt("kept_promised_send_visit_or_call", { receiptId: "m04-boundary" }),
      ],
      nowMs: NOW_MS,
      nowIso: NOW_ISO,
    });
    expect(result.playerPayload?.title).toBe("HELD");
    expect(await presentations.loadForOperator(scope)).toEqual([]);
    expect(PRESENTATION_RECEIPT_STATUSES).toEqual([
      "prepared",
      "rendered_to_surface",
    ]);
    const snapshot = (await store.load(scope))!;
    expect(
      await renderPlayerPresentationToSurface({
        presentationStore: presentations,
        snapshot,
        occurrenceLedgerEntryId: result.presentation!.occurrenceLedgerEntryId,
        nowIso: NOW_ISO,
      })
    ).toBeNull();
    const prepared = await preparePlayerPresentationForOccurrence({
      presentationStore: presentations,
      snapshot,
      occurrenceLedgerEntryId: result.presentation!.occurrenceLedgerEntryId,
      nowIso: NOW_ISO,
    });
    expect(prepared?.receipt.status).toBe("prepared");
    expect(prepared?.receipt.renderedAt).toBeNull();
    const knowledgeBefore = JSON.stringify(snapshot.knowledge);
    const rendered = await renderPlayerPresentationToSurface({
      presentationStore: presentations,
      snapshot,
      occurrenceLedgerEntryId: result.presentation!.occurrenceLedgerEntryId,
      nowIso: "2026-09-21T02:00:00.000Z",
    });
    expect(rendered?.receipt.status).toBe("rendered_to_surface");
    expect(rendered?.payload.title).toBe("HELD");
    const again = await renderPlayerPresentationToSurface({
      presentationStore: presentations,
      snapshot,
      occurrenceLedgerEntryId: result.presentation!.occurrenceLedgerEntryId,
      nowIso: "2026-09-21T03:00:00.000Z",
    });
    expect(again?.receipt.renderedAt).toBe(rendered?.receipt.renderedAt);
    expect(JSON.stringify((await store.load(scope))!.knowledge)).toBe(knowledgeBefore);
    expect(await presentations.loadForOperator(scope)).toHaveLength(1);
  });

  it("refuses unverified input and does not roll business truth back when Narrator fails", async () => {
    const store = await seeded();
    const plain = await advanceNarratorAfterVerifiedOutcome({
      store,
      scope,
      verifiedGoldline: [
        { verificationClass: "VERIFIED", outcomeId: "kept_promised_send_visit_or_call" } as never,
      ],
      nowMs: NOW_MS,
      nowIso: NOW_ISO,
    });
    expect(plain.advanced).toBe(false);
    expect(plain.narrationFailed).toBe(false);
    expect(plain.presentation).toBeNull();
    expect((await store.load(scope))?.ledger).toEqual([]);

    const empty = await advanceNarratorAfterVerifiedOutcome({
      store,
      scope,
      verifiedGoldline: [],
      nowMs: NOW_MS,
    });
    expect(empty.failureReason).toBe("no_verified_goldline_receipt");

    const failing: NarratorStore = {
      ...(await (async () => store)()),
      async commitAtomic() {
        throw new Error("narrator commit failed");
      },
    };
    const boom = await advanceNarratorAfterVerifiedOutcome({
      store: failing,
      scope,
      verifiedGoldline: [
        issueReceipt("kept_promised_send_visit_or_call", { receiptId: "m04-fail" }),
      ],
      nowMs: NOW_MS,
      nowIso: NOW_ISO,
    });
    expect(boom.narrationFailed).toBe(true);
    expect(boom.presentation).toBeNull();
    expect((await store.load(scope))?.ledger).toEqual([]);
    expect(REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS).toEqual([]);
  });

  it("identifies its own committed occurrence when a same-beat row is committed beside it", async () => {
    const inner = await seeded();
    let injected = false;
    const store: NarratorStore = {
      ...inner,
      async commitAtomic(commitScope, commit) {
        if (!injected && commit.ledgerEntry.kind === "FIRED_AUTHORED_BEAT") {
          injected = true;
          const snap = await inner.load(commitScope);
          if (!snap) throw new Error("missing snapshot");
          await inner.commitAtomic(commitScope, {
            knowledge: snap.knowledge,
            narrativeState: snap.narrativeState,
            ledgerEntry: {
              kind: "FIRED_AUTHORED_BEAT",
              beatId: "M03",
              goldlineOutcomeId: null,
              offscreen: false,
              playerVisible: true,
              evidenceRef: null,
              occurredAt: "2026-09-14T12:00:00.000Z",
              idempotencyKey: "concurrent-same-beat-m03",
              id: "concurrent-m03-ledger",
            },
          });
        }
        return inner.commitAtomic(commitScope, commit);
      },
    };
    const result = await advanceNarratorAfterVerifiedOutcome({
      store,
      scope,
      verifiedGoldline: [
        issueReceipt("silence_eligible_for_retry", {
          receiptId: "m03-race-arm",
          targetId: "target-race",
          occurredAtMs: MONDAY_MS,
        }),
        issueReceipt("legitimate_second_site_visit", {
          receiptId: "m03-race-return",
          targetId: "target-race",
          occurredAtMs: TUESDAY_MS,
        }),
      ],
      nowMs: NOW_MS,
      nowIso: NOW_ISO,
    });
    const snapshot = (await store.load(scope))!;
    const fired = snapshot.ledger.filter(entry => entry.kind === "FIRED_AUTHORED_BEAT");
    expect(fired.map(entry => entry.id)[0]).toBe("concurrent-m03-ledger");
    expect(fired).toHaveLength(2);
    expect(result.presentation).not.toBeNull();
    expect(result.presentation?.occurrenceLedgerEntryId).not.toBe(
      "concurrent-m03-ledger"
    );
    const own = fired.find(
      entry => entry.id === result.presentation?.occurrenceLedgerEntryId
    );
    expect(own?.idempotencyKey).not.toBe("concurrent-same-beat-m03");
    expect(own?.beatId).toBe("M03");
    expect(result.playerPayload?.occurrenceLedgerEntryId).toBe(
      result.presentation?.occurrenceLedgerEntryId
    );
  });

  it("keeps the first renderedAt when a second render uses a later timestamp", async () => {
    const store = await seeded();
    const presentations = createInMemoryNarratorPresentationStore();
    const result = await advanceNarratorAfterVerifiedOutcome({
      store,
      scope,
      verifiedGoldline: [
        issueReceipt("kept_promised_send_visit_or_call", { receiptId: "m04-cas" }),
      ],
      nowMs: NOW_MS,
      nowIso: NOW_ISO,
    });
    const snapshot = (await store.load(scope))!;
    const firstStamp = "2026-09-21T01:00:00.000Z";
    const secondStamp = "2026-09-21T09:00:00.000Z";
    await preparePlayerPresentationForOccurrence({
      presentationStore: presentations,
      snapshot,
      occurrenceLedgerEntryId: result.presentation!.occurrenceLedgerEntryId,
      nowIso: NOW_ISO,
    });
    const first = await presentations.markRendered({
      scope,
      occurrenceLedgerEntryId: result.presentation!.occurrenceLedgerEntryId,
      renderedAt: firstStamp,
    });
    const second = await presentations.markRendered({
      scope,
      occurrenceLedgerEntryId: result.presentation!.occurrenceLedgerEntryId,
      renderedAt: secondStamp,
    });
    expect(first?.renderedAt).toBe(firstStamp);
    expect(second?.renderedAt).toBe(firstStamp);
    expect(second?.status).toBe("rendered_to_surface");
    const canonical = await presentations.findByOccurrence(
      scope,
      result.presentation!.occurrenceLedgerEntryId
    );
    expect(canonical?.renderedAt).toBe(firstStamp);
  });

  it("does not mint Goldline receipts or author story prose", () => {
    const advance = readFileSync(
      resolve(process.cwd(), "server/narratorOs/advanceAfterVerifiedOutcome.ts"),
      "utf8"
    );
    const plan = readFileSync(
      resolve(process.cwd(), "server/narratorOs/presentationPlan.ts"),
      "utf8"
    );
    const player = readFileSync(
      resolve(process.cwd(), "server/narratorOs/playerPresentation.ts"),
      "utf8"
    );
    const ingest = readFileSync(
      resolve(process.cwd(), "server/goldlineVerification/ingestVerifiedGoldlineOutcome.ts"),
      "utf8"
    );
    const claireTurn = readFileSync(
      resolve(process.cwd(), "server/claire/turn/claireTurn.ts"),
      "utf8"
    );
    expect(advance).not.toMatch(/issueVerifiedGoldlineReceipt|recordVerifiedGoldlineOutcome/);
    expect(advance).not.toMatch(/REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS\s*=/);
    expect(ingest).not.toMatch(/advanceNarratorAfterVerifiedOutcome/);
    expect(claireTurn).not.toMatch(
      /advanceNarratorAfterVerifiedOutcome|orchestrateSelectedBeatReaction|evaluateProductionEligibility/
    );
    const index = readFileSync(
      resolve(process.cwd(), "server/narratorOs/index.ts"),
      "utf8"
    );
    const drizzle = readFileSync(
      resolve(process.cwd(), "server/narratorOs/presentationDrizzleStore.ts"),
      "utf8"
    );
    expect(plan + player).not.toMatch(
      /congratulat|kintsugi|rapport gain|quiet effect|courtyard/i
    );
    expect(index).not.toMatch(/rememberNarrativePresentationPlanForTests/);
    expect(claireTurn + advance).not.toMatch(
      /rememberNarrativePresentationPlanForTests/
    );
    expect(advance).not.toMatch(/beforeIds/);
    const deriveAt = plan.indexOf("export function deriveNarrativePresentationPlan");
    const attestAt = plan.indexOf("isAuthoritativeNarratorSnapshot", deriveAt);
    const mintAt = plan.indexOf("trustedNarrativePresentationPlans.add", deriveAt);
    expect(attestAt).toBeGreaterThan(deriveAt);
    expect(mintAt).toBeGreaterThan(attestAt);
    expect(index).not.toMatch(/isAuthoritativeNarratorSnapshot/);
    expect(drizzle).toMatch(/status,\s*"prepared"/);
    expect(drizzle).not.toMatch(/renderedAt: input\.renderedAt/);
    expect(player).not.toMatch(/commitAtomic|replaceKnowledge|appendLedger/);
  });
});
