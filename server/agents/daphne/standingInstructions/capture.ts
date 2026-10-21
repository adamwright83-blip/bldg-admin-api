import { resolveCanonicalOperatorIdentity } from "../../persistentOperator/identity";
import { recordDaphneObservation } from "../observationStore";
import { describeReviewWindow, detectStandingInstructions, topicLabel } from "./detect";
import {
  drizzleStandingInstructionStore,
  standingInstructionFingerprint,
  type StandingInstructionStore,
} from "./store";
import type { DetectedStandingInstruction, ReviewWindowPayload, StandingInstructionRecord } from "./types";

export type StandingInstructionCaptureResult = {
  status: "disabled" | "no_match" | "identity_unresolved" | "persisted" | "persistence_failed" | "readback_failed";
  detected: DetectedStandingInstruction[];
  records: StandingInstructionRecord[];
  readbackVerified: boolean;
  /** What Claire may say about this capture. Only a verified readback says the rule is saved. */
  speech: string | null;
};

/** On by default. `CLAIRE_STANDING_INSTRUCTIONS=0` is the kill switch. */
export function isStandingInstructionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.CLAIRE_STANDING_INSTRUCTIONS?.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "off");
}

export const STANDING_INSTRUCTION_SAVE_FAILED =
  "I heard that as a standing rule, but I couldn't save it, so I won't claim it is remembered.";

/**
 * Spoken only from rows that were read back. No "I'll …" (the system keeps these, Claire does not promise them)
 * and no leading "Saved" (assertionGuard reserves that for receipt-backed renderers).
 */
export function standingInstructionReadback(records: readonly StandingInstructionRecord[]): string {
  return records
    .map(record => {
      if (record.kind === "encouragement_every_call") {
        return record.status === "revoked"
          ? "Understood, no more encouragement lines. That change is saved."
          : "That's a standing rule now, saved for every call: one grounded line of encouragement.";
      }
      if (record.kind === "review_window") {
        const window = record.payload as ReviewWindowPayload;
        return `That's a standing rule now, saved: ${window.topics.map(topicLabel).join(" and ")} wait for ${describeReviewWindow(window)}.`;
      }
      if (record.kind === "role_feedback") {
        return "You're right, that's on me. It's a standing rule now, saved: every call opens with the goal and the plan.";
      }
      return `That's a standing rule now, saved: ${record.quote.trim().replace(/\s+/g, " ").slice(0, 160)}`;
    })
    .join(" ");
}

export async function captureStandingInstructions(
  input: {
    tenantId: string;
    operatorUserId: string;
    utterance: string;
    conversationId: string;
    turnId: string;
    priorClaireTurn?: string | null;
  },
  dependencies: {
    enabled?: (tenantId: string) => boolean;
    resolveIdentity?: typeof resolveCanonicalOperatorIdentity;
    store?: StandingInstructionStore;
    recordObservation?: typeof recordDaphneObservation;
  } = {}
): Promise<StandingInstructionCaptureResult> {
  const detected = detectStandingInstructions(input.utterance, { priorClaireTurn: input.priorClaireTurn });
  const out = (status: StandingInstructionCaptureResult["status"], records: StandingInstructionRecord[] = []): StandingInstructionCaptureResult => {
    const verified = status === "persisted";
    if (detected.length) {
      console.info("[ClaireStandingInstructions]", JSON.stringify({ event: "capture", status, kinds: detected.map(item => item.kind) }));
    }
    return {
      status,
      detected,
      records,
      readbackVerified: verified,
      speech: !detected.length || status === "disabled"
        ? null
        : verified
          ? standingInstructionReadback(records)
          : STANDING_INSTRUCTION_SAVE_FAILED,
    };
  };
  if (!detected.length) return out("no_match");
  if (!(dependencies.enabled ?? (() => isStandingInstructionsEnabled()))(input.tenantId)) return out("disabled");

  const raw = input.operatorUserId.trim();
  const source = /^\d+$/.test(raw) ? { type: "user_id" as const, value: Number(raw) } : { type: "open_id" as const, value: raw };
  const resolution = await (dependencies.resolveIdentity ?? resolveCanonicalOperatorIdentity)({
    tenantId: input.tenantId,
    source,
    subsystem: "claire_standing_instructions",
  }).catch(() => null);
  if (!resolution?.ok) return out("identity_unresolved");

  const scope = { tenantId: input.tenantId, canonicalOperatorId: resolution.identity.canonicalOperatorId };
  const store = dependencies.store ?? drizzleStandingInstructionStore();
  const written: StandingInstructionRecord[] = [];
  try {
    for (const item of detected) {
      const append = {
        ...scope,
        operatorUserId: raw,
        detected: item,
        sourceConversationKey: input.conversationId,
        sourceTurnId: input.turnId,
      };
      written.push(await store.append(append));
      // Provenance for Daphne. Failing to record it never un-saves the rule.
      await (dependencies.recordObservation ?? recordDaphneObservation)({
        tenantId: input.tenantId,
        canonicalOperatorId: scope.canonicalOperatorId,
        operatorUserId: raw,
        sessionId: input.conversationId,
        actorType: "user",
        actorId: raw,
        agentId: "claire",
        observationKind: "preference_declaration",
        evidenceChannel: "stated",
        verificationStatus: "attested",
        sourceType: "claire_standing_instruction",
        sourceReference: `turn:${input.turnId}`.slice(0, 191),
        occurredAt: new Date(),
        payload: { kind: item.kind, subjectKey: item.subjectKey, status: item.status, evidenceText: item.quote.slice(0, 1000) },
        idempotencyKey: `standing-instruction:${standingInstructionFingerprint(append)}`,
      }).catch(() => undefined);
    }
  } catch {
    return out("persistence_failed");
  }

  // A successful write is not an acknowledgement: require a fresh durable read of exactly these rows.
  try {
    const [all, active] = await Promise.all([store.listAll(scope), store.listActive(scope)]);
    const verified = written.every(record => {
      const stored = all.find(row => row.id === record.id);
      if (!stored || stored.text !== record.text || stored.status !== record.status) return false;
      const inForce = active.some(row => row.id === record.id);
      return record.status === "active" ? inForce : !active.some(row => row.subjectKey === record.subjectKey);
    });
    return out(verified ? "persisted" : "readback_failed", written);
  } catch {
    return out("readback_failed", written);
  }
}

/** Active rules for a prompt. Always a fresh read; a failed read is an empty list, never a stale one. */
export async function loadActiveStandingInstructions(
  input: { tenantId: string; operatorUserId: string },
  dependencies: { resolveIdentity?: typeof resolveCanonicalOperatorIdentity; store?: StandingInstructionStore } = {}
): Promise<StandingInstructionRecord[]> {
  if (!isStandingInstructionsEnabled()) return [];
  const raw = input.operatorUserId.trim();
  if (!raw) return [];
  const source = /^\d+$/.test(raw) ? { type: "user_id" as const, value: Number(raw) } : { type: "open_id" as const, value: raw };
  const resolution = await (dependencies.resolveIdentity ?? resolveCanonicalOperatorIdentity)({
    tenantId: input.tenantId,
    source,
    subsystem: "claire_standing_instructions",
  }).catch(() => null);
  if (!resolution?.ok) return [];
  return loadActiveStandingInstructionsForOperator(
    { tenantId: input.tenantId, canonicalOperatorId: resolution.identity.canonicalOperatorId },
    dependencies.store
  );
}

export async function loadActiveStandingInstructionsForOperator(
  scope: { tenantId: string; canonicalOperatorId: string },
  store: StandingInstructionStore = drizzleStandingInstructionStore()
): Promise<StandingInstructionRecord[]> {
  if (!isStandingInstructionsEnabled()) return [];
  return store.listActive(scope).catch(error => {
    console.warn("[ClaireStandingInstructions] could not read active instructions", error instanceof Error ? error.message : error);
    return [];
  });
}
