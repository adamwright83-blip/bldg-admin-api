/**
 * Claire V1 character context for one Rook CONTACT social residue.
 * Eligibility is this module. It does not speak, and it does not promote
 * Brain V2. Unrelated turns receive nothing.
 */
import type { RookContactInterventionResidue } from "../../shared/narratorOs/contracts";
import { createDrizzleNarratorStore } from "../narratorOs/drizzleStore";
import { narrativeMemoryView } from "../narratorOs/narrativeReadModels";

export type ClaireRookContactResidueContext = RookContactInterventionResidue & {
  tenantId: string;
  operatorUserId: string;
};

const CALL_WORD = /\b(call|called|calling|dial|dialed|dialled|phone|phoned)\b/i;
const ROOK_WORD = /\brook\b/i;

export function utteranceMateriallyAboutRookContact(
  utterance: string,
  residue: Pick<
    ClaireRookContactResidueContext,
    "contactSessionId" | "accountName" | "contactName"
  >
): boolean {
  const text = utterance.toLowerCase();
  if (residue.contactSessionId && text.includes(residue.contactSessionId.toLowerCase())) {
    return true;
  }
  const mentionsRook = ROOK_WORD.test(utterance);
  if (mentionsRook) return true;
  const mentionsCall = CALL_WORD.test(utterance);
  const account = residue.accountName.trim().toLowerCase();
  const contact = residue.contactName?.trim().toLowerCase() ?? "";
  const mentionsTarget =
    (account.length > 1 && text.includes(account)) ||
    (contact.length > 1 && text.includes(contact));
  return mentionsTarget && mentionsCall;
}

export async function loadClaireRookContactResidues(input: {
  tenantId: string;
  operatorUserId: string;
}): Promise<ClaireRookContactResidueContext[]> {
  try {
    const snapshot = await createDrizzleNarratorStore().load({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
    });
    if (!snapshot) return [];
    if (
      snapshot.tenantId !== input.tenantId ||
      snapshot.operatorUserId !== input.operatorUserId
    ) {
      return [];
    }
    return narrativeMemoryView(snapshot).socialResidues
      .filter(
        row =>
          row.tenantId === input.tenantId &&
          row.operatorUserId === input.operatorUserId
      )
      .map(row => ({
        ...row.residue,
        tenantId: row.tenantId,
        operatorUserId: row.operatorUserId,
      }));
  } catch {
    return [];
  }
}

export function claireRookContactResidueSection(input: {
  tenantId: string;
  operatorUserId: string;
  utterance: string;
  residues: readonly ClaireRookContactResidueContext[];
}): string | null {
  const matched = input.residues.filter(
    residue =>
      residue.tenantId === input.tenantId &&
      residue.operatorUserId === input.operatorUserId &&
      utteranceMateriallyAboutRookContact(input.utterance, residue)
  );
  if (!matched.length) return null;
  return matched
    .map(residue =>
      [
        "Narrative memory of a shared Rook CONTACT intervention. Not business authority. Not a verified commercial outcome. Do not read a ledger row aloud.",
        `Event: ${residue.event}.`,
        `Session: ${residue.contactSessionId}.`,
        `Canonical account: ${residue.accountName} (${residue.accountId}).`,
        `Canonical contact: ${residue.contactName ?? "unnamed"} (${residue.contactId}).`,
        `Occurred at: ${residue.occurredAt}.`,
        "Authored Rook framing: UNKNOWN.",
        "Unobserved motive is not recorded. Do not invent why Rook acted and do not diagnose the operator.",
        "Do not treat connection, duration, or a completed call as a commercial advance.",
      ].join(" ")
    )
    .join("\n");
}
