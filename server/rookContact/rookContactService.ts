/**
 * CONTACT execution. Backend only.
 *
 * Requires companion.rook, capability.rook.contact, a canonical commercial
 * contact, and an operator authorization for this session and contact id.
 * Authorization is this server action. It is not parsed from a transcript.
 *
 * The dial reuses placeOperatorFirstBridgeCall. The prospect number is loaded
 * from commercial contact state. Kingdom 2 is not completed here and is not decided.
 */
import { and, eq } from "drizzle-orm";
import { commercialAccountContacts, commercialAccounts } from "../../drizzle/schema";
import { defaultAuthorityForGoldlineAction } from "../../shared/goldlineActionContract";
import type { RookContactEvidenceRef } from "../../shared/rookContact";
import { authorizedOperatorPhone, claireTwilioFromNumber } from "../claire/claireTwilio";
import { getDb } from "../db";
import { findRookContactGrant } from "../goldlineProgression/capabilityGrantStore";
import {
  ProgressionNotPermittedError,
} from "../goldlineProgression/progressionContract";
import { findDomainProgression } from "../goldlineProgression/progressionStore";
import { assertVerifiedOutgoingCallerId, placeOperatorFirstBridgeCall } from "../salesCalls";
import { evaluateRookContactTransport } from "./rookContactCallTruth";
import {
  canonicalContactEvidence,
  groundRookContactLanguage,
  type RookContactDraftSentence,
  type RookContactGroundedSentence,
} from "./rookContactGrounding";
import {
  attachRookContactSessionCallAttempt,
  claimRookContactSessionDial,
  findRookContactSession,
  insertPreparedRookContactSession,
  markRookContactSessionAuthorized,
  markRookContactSessionFailed,
  type RookContactSession,
} from "./rookContactSessionStore";

const CLIENT_FORBIDDEN_KEYS = [
  "phone",
  "customerPhone",
  "prospectPhone",
  "to",
  "callerId",
  "contactGranted",
  "capabilityGranted",
  "capabilityId",
  "rookOwned",
  "waywardComplete",
  "resolved",
  "localStorage",
  "granted",
] as const;

export class RookContactClosedError extends Error {
  readonly code = "rook_contact_closed" as const;
  constructor(message: string) {
    super(message);
    this.name = "RookContactClosedError";
  }
}

export class RookContactForgeError extends Error {
  readonly code = "client_forge_rejected" as const;
  readonly key: string;
  constructor(key: string) {
    super(`Client cannot set CONTACT destination or grant (${key})`);
    this.name = "RookContactForgeError";
    this.key = key;
  }
}

export function rejectRookContactClientForge(input: unknown): void {
  if (!input || typeof input !== "object") return;
  for (const key of CLIENT_FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      throw new RookContactForgeError(key);
    }
  }
}

async function requireContactReady(input: { tenantId: string; operatorId: string }): Promise<void> {
  const stored = await findDomainProgression(input);
  if (!stored.readable || !stored.row?.companionRookOwnedAt) {
    throw new ProgressionNotPermittedError(
      "CONTACT requires companion.rook. Owning Rook is not this capability, and this action does not own him."
    );
  }
  const grant = await findRookContactGrant(input);
  if (!grant.readable || !grant.grant) {
    throw new ProgressionNotPermittedError(
      "capability.rook.contact is not granted. Owning Rook does not grant CONTACT."
    );
  }
}

async function loadCanonicalContact(input: {
  tenantId: string;
  accountId: number;
  contactId: number;
}): Promise<{
  accountName: string;
  contactName: string | null;
  contactTitle: string | null;
  phone: string;
}> {
  const db = await getDb();
  if (!db) throw new RookContactClosedError("Database not available");
  const [account] = await db
    .select({
      id: commercialAccounts.id,
      tenantId: commercialAccounts.tenantId,
      name: commercialAccounts.name,
    })
    .from(commercialAccounts)
    .where(
      and(
        eq(commercialAccounts.id, input.accountId),
        eq(commercialAccounts.tenantId, input.tenantId)
      )
    )
    .limit(1);
  if (!account || account.tenantId !== input.tenantId || account.id !== input.accountId) {
    throw new RookContactClosedError("canonical commercial account is missing for this tenant");
  }
  const [contact] = await db
    .select({
      id: commercialAccountContacts.id,
      tenantId: commercialAccountContacts.tenantId,
      accountId: commercialAccountContacts.accountId,
      name: commercialAccountContacts.name,
      title: commercialAccountContacts.title,
      phone: commercialAccountContacts.phone,
    })
    .from(commercialAccountContacts)
    .where(
      and(
        eq(commercialAccountContacts.id, input.contactId),
        eq(commercialAccountContacts.tenantId, input.tenantId),
        eq(commercialAccountContacts.accountId, input.accountId)
      )
    )
    .limit(1);
  if (
    !contact ||
    contact.tenantId !== input.tenantId ||
    contact.accountId !== input.accountId ||
    contact.id !== input.contactId
  ) {
    throw new RookContactClosedError(
      "canonical commercial contact is missing for this tenant and account"
    );
  }
  const phone = typeof contact.phone === "string" ? contact.phone.trim() : "";
  if (!phone) {
    throw new RookContactClosedError("canonical commercial contact has no phone");
  }
  return {
    accountName: account.name,
    contactName: contact.name,
    contactTitle: contact.title,
    phone,
  };
}

function evidenceRefs(accountId: number, contactId: number): RookContactEvidenceRef[] {
  return [
    { source: "commercial_account", id: String(accountId) },
    { source: "commercial_account_contact", id: String(contactId) },
  ];
}

export async function prepareRookContactSession(input: {
  tenantId: string;
  operatorId: string;
  accountId: number;
  contactId: number;
}): Promise<RookContactSession> {
  rejectRookContactClientForge(input);
  await requireContactReady(input);
  await loadCanonicalContact(input);
  return insertPreparedRookContactSession({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    accountId: input.accountId,
    contactId: input.contactId,
    evidenceRefs: evidenceRefs(input.accountId, input.contactId),
    at: new Date(),
  });
}

/**
 * Server-authenticated authorization for this session and this contact id.
 * Does not dial. Does not read a transcript.
 */
export async function authorizeRookContactSession(input: {
  tenantId: string;
  operatorId: string;
  contactSessionId: string;
  contactId: number;
}): Promise<RookContactSession> {
  rejectRookContactClientForge(input);
  await requireContactReady(input);
  const session = await findRookContactSession(input);
  if (!session) throw new RookContactClosedError("CONTACT session was not found for this operator");
  if (session.contactId !== input.contactId || session.accountId == null) {
    throw new RookContactClosedError("CONTACT authorization does not match the canonical contact");
  }
  await loadCanonicalContact({
    tenantId: input.tenantId,
    accountId: session.accountId,
    contactId: input.contactId,
  });
  if (session.status === "authorized" && session.operatorAuthorizedAt) return session;
  if (session.status !== "prepared" || session.operatorAuthorizedAt) {
    throw new RookContactClosedError("CONTACT session cannot be authorized from its current fact");
  }
  const at = new Date();
  await markRookContactSessionAuthorized({ ...input, at });
  const authorized = await findRookContactSession(input);
  if (!authorized?.operatorAuthorizedAt || authorized.contactId !== input.contactId) {
    throw new RookContactClosedError("CONTACT authorization was not recorded");
  }
  return authorized;
}

/**
 * Dials the operator first via the existing bridge. The prospect number is
 * reloaded from the canonical contact. Recording stays off inside that bridge.
 * CALL remains HUMAN_EXECUTION: this does not escalate authority.
 */
export async function startRookContactBridge(input: {
  tenantId: string;
  operatorId: string;
  contactSessionId: string;
}): Promise<RookContactSession> {
  rejectRookContactClientForge(input);
  if (defaultAuthorityForGoldlineAction("CALL") !== "HUMAN_EXECUTION") {
    throw new RookContactClosedError("CALL authority is no longer human execution");
  }
  await requireContactReady(input);
  const session = await findRookContactSession(input);
  if (!session) throw new RookContactClosedError("CONTACT session was not found for this operator");
  if (session.status === "dialing_operator") {
    if (session.callAttemptId) return session;
    throw new RookContactClosedError("CONTACT dial is already starting for this session");
  }
  if (session.status !== "authorized" || !session.operatorAuthorizedAt) {
    throw new RookContactClosedError(
      "CONTACT does not dial without operator authorization for this session"
    );
  }
  const canonical = await loadCanonicalContact({
    tenantId: input.tenantId,
    accountId: session.accountId,
    contactId: session.contactId,
  });
  const operatorLegTo = await authorizedOperatorPhone({
    tenantId: input.tenantId,
    actorId: input.operatorId,
  });
  const operatorLegFrom = claireTwilioFromNumber();
  await assertVerifiedOutgoingCallerId(operatorLegTo);

  const claimed = await claimRookContactSessionDial({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    contactSessionId: session.contactSessionId,
    at: new Date(),
  });
  if (!claimed) {
    const existing = await findRookContactSession(input);
    if (existing?.status === "dialing_operator" && existing.callAttemptId) return existing;
    throw new RookContactClosedError("CONTACT dial is already starting or was already claimed");
  }

  let placed: { attemptId: number; repLegCallSid: string };
  try {
    placed = await placeOperatorFirstBridgeCall({
      tenantId: input.tenantId,
      legs: {
        operatorLegTo,
        operatorLegFrom,
        prospectLegTo: canonical.phone,
        prospectCallerId: operatorLegTo,
      },
    });
  } catch (error) {
    await markRookContactSessionFailed({
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      contactSessionId: session.contactSessionId,
      at: new Date(),
    });
    throw error;
  }

  const attached = await attachRookContactSessionCallAttempt({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    contactSessionId: session.contactSessionId,
    callAttemptId: placed.attemptId,
    at: new Date(),
  });
  const dialing = await findRookContactSession(input);
  if (
    !attached ||
    !dialing ||
    dialing.status !== "dialing_operator" ||
    dialing.callAttemptId !== placed.attemptId
  ) {
    // The external call already exists. Never mark this "failed" here: that
    // would hide a live attempt and could invite a retry that places another.
    throw new RookContactClosedError(
      "CONTACT operator call was placed but its attempt linkage was not recorded"
    );
  }
  return dialing;
}

export async function groundRookContactDraft(input: {
  tenantId: string;
  operatorId: string;
  contactSessionId: string;
  sentences: readonly RookContactDraftSentence[];
}): Promise<RookContactGroundedSentence[]> {
  rejectRookContactClientForge(input);
  await requireContactReady(input);
  const session = await findRookContactSession(input);
  if (!session) throw new RookContactClosedError("CONTACT session was not found for this operator");
  const canonical = await loadCanonicalContact({
    tenantId: input.tenantId,
    accountId: session.accountId,
    contactId: session.contactId,
  });
  return groundRookContactLanguage({
    sentences: input.sentences,
    evidence: canonicalContactEvidence({
      accountId: session.accountId,
      accountName: canonical.accountName,
      contactId: session.contactId,
      contactName: canonical.contactName,
      contactTitle: canonical.contactTitle,
    }),
  });
}

export { evaluateRookContactTransport };
