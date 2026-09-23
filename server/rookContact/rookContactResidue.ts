/**
 * Narrator social residue for one server-known CONTACT session.
 * Narrative memory only. It does not grant CONTACT, prove a commercial
 * outcome, or store a motive.
 */
import type { RookContactInterventionResidue } from "../../shared/narratorOs/contracts";
import type { NarrativeEventLedgerEntry } from "../../shared/narratorOs/contracts";
import { createDrizzleNarratorStore } from "../narratorOs/drizzleStore";
import { narrativeMemoryView } from "../narratorOs/narrativeReadModels";
import {
  applyKnowledgeWrite,
  type NarratorSnapshot,
  type NarratorStore,
} from "../narratorOs/store";
import type { RookContactSession } from "./rookContactSessionStore";

export const ROOK_CONTACT_INTERVENTION_EVENT = "rook.contact_intervention" as const;

export class RookContactResidueError extends Error {
  readonly code = "rook_contact_residue_refused" as const;
  constructor(message: string) {
    super(message);
    this.name = "RookContactResidueError";
  }
}

export async function recordRookContactInterventionResidue(input: {
  store: NarratorStore;
  session: RookContactSession;
  accountName: string;
  contactName: string | null;
  occurredAt: string;
  /** The session id the caller claims. It must be the loaded row. */
  claimedSessionId: string;
  claimedTenantId: string;
  claimedOperatorId: string;
}): Promise<NarrativeEventLedgerEntry> {
  const session = input.session;
  if (
    session.contactSessionId !== input.claimedSessionId ||
    session.tenantId !== input.claimedTenantId ||
    session.operatorId !== input.claimedOperatorId
  ) {
    throw new RookContactResidueError(
      "CONTACT residue requires the loaded session for this tenant and operator"
    );
  }
  if (!session.callAttemptId) {
    throw new RookContactResidueError(
      "CONTACT residue requires a server-linked call attempt on this session"
    );
  }
  const scope = {
    tenantId: session.tenantId,
    operatorUserId: session.operatorId,
  };
  let snapshot = await input.store.load(scope);
  if (!snapshot) snapshot = await input.store.initOperator(scope);
  const residue: RookContactInterventionResidue = {
    event: ROOK_CONTACT_INTERVENTION_EVENT,
    contactSessionId: session.contactSessionId,
    accountId: session.accountId,
    contactId: session.contactId,
    accountName: input.accountName,
    contactName: input.contactName,
    occurredAt: input.occurredAt,
    authoredRookFraming: "UNKNOWN",
    evidenceRefs: session.evidenceRefs.map(ref => ({
      source: ref.source,
      id: ref.id,
    })),
  };
  const knowledge = applyKnowledgeWrite(snapshot.knowledge, {
    plane: "CLAIRE",
    factId: ROOK_CONTACT_INTERVENTION_EVENT,
    op: "learn",
    kind: "EVENT_FACT",
  });
  return input.store.commitAtomic(scope, {
    knowledge,
    narrativeState: snapshot.narrativeState,
    ledgerEntry: {
      kind: "SOCIAL_RESIDUE",
      beatId: null,
      goldlineOutcomeId: null,
      offscreen: false,
      playerVisible: false,
      evidenceRef: null,
      occurredAt: input.occurredAt,
      idempotencyKey: `${ROOK_CONTACT_INTERVENTION_EVENT}:${session.contactSessionId}`,
      socialResidue: residue,
      persistedVerifiedGoldline: null,
    },
  });
}

export async function rememberRookContactIntervention(input: {
  session: RookContactSession;
  accountName: string;
  contactName: string | null;
  occurredAt: string;
}): Promise<void> {
  try {
    const store = createDrizzleNarratorStore();
    await recordRookContactInterventionResidue({
      store,
      session: input.session,
      accountName: input.accountName,
      contactName: input.contactName,
      occurredAt: input.occurredAt,
      claimedSessionId: input.session.contactSessionId,
      claimedTenantId: input.session.tenantId,
      claimedOperatorId: input.session.operatorId,
    });
  } catch (error) {
    console.warn(
      "[rook-contact] social residue was not recorded",
      error instanceof Error ? error.message : error
    );
  }
}

export function residueProvesBusinessOutcome(
  entry: NarrativeEventLedgerEntry | null | undefined
): false {
  void entry;
  return false;
}

export function socialResiduesForScope(snapshot: NarratorSnapshot) {
  return narrativeMemoryView(snapshot).socialResidues.filter(
    row =>
      row.tenantId === snapshot.tenantId &&
      row.operatorUserId === snapshot.operatorUserId
  );
}
