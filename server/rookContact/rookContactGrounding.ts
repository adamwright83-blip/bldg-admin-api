/**
 * Rook may draft from known evidence. Business language does not invent facts.
 *
 * Labels:
 * - VERIFIED / GROUNDED — a stored canonical fact matched this sentence.
 *   Wording is not a separate authority; both labels require that evidence.
 * - GENERAL_GUIDANCE — not a verified account fact.
 * - UNKNOWN — stays unknown. A model label cannot promote it.
 * - MODEL_PHRASING — character wording only, never authority.
 *
 * Matching is normalized equality against server evidence, the same rule as
 * reconciling a claim to a stored display value. It is not a scan that bans
 * phrases inside unrelated sentences.
 */
import {
  ROOK_CONTACT_CAPABILITY_ID,
  ROOK_OUTREACH_DRAFTING_CAPABILITY_ID,
} from "../../shared/rookContact";

export const ROOK_CONTACT_LABELS = [
  "VERIFIED",
  "GROUNDED",
  "GENERAL_GUIDANCE",
  "UNKNOWN",
  "MODEL_PHRASING",
] as const;

export type RookContactLabel = (typeof ROOK_CONTACT_LABELS)[number];

export const ROOK_CONTACT_BUSINESS_ASSERTIONS = [
  { claimKey: "asked_to_call", text: "They asked you to call." },
  { claimKey: "expecting_call", text: "They're expecting your call." },
  { claimKey: "available_now", text: "They're available right now." },
  { claimKey: "wanted_follow_up", text: "They wanted you to follow up." },
  { claimKey: "replied", text: "They replied." },
  { claimKey: "interested", text: "They were interested." },
  { claimKey: "referred", text: "They referred us." },
  { claimKey: "spoke_last_week", text: "You spoke last week." },
  { claimKey: "approved", text: "They approved this." },
  { claimKey: "ready_to_move_forward", text: "They're ready to move forward." },
  { claimKey: "already_knows_you", text: "They already know who you are." },
] as const;

export type RookContactBusinessClaimKey =
  (typeof ROOK_CONTACT_BUSINESS_ASSERTIONS)[number]["claimKey"];

const CHARACTER_LINES = ["I found an opening"] as const;

const ACCOUNT_FACT_SOURCES = new Set(["canonical_account", "canonical_contact"]);

export type RookContactEvidenceSource =
  | "canonical_account"
  | "canonical_contact"
  | "communication_receipt"
  | "general_guidance";

export type RookContactEvidence = {
  id: string;
  claimKey: string;
  displayValue: string;
  sourceType: RookContactEvidenceSource;
};

export type RookContactDraftSentence = {
  text: string;
  /** Ignored as authority. The server assigns the label. */
  proposedLabel?: string | null;
  claimKey?: string | null;
  evidenceReferenceId?: string | null;
};

export type RookContactGroundedSentence = {
  text: string;
  label: RookContactLabel;
  claimKey: string | null;
  blocked: boolean;
  authority: "evidence" | false;
  verifiedAccountFact: boolean;
  capabilityId: typeof ROOK_CONTACT_CAPABILITY_ID;
  implementationCapabilityId: typeof ROOK_OUTREACH_DRAFTING_CAPABILITY_ID;
};

export function normalizeRookContactText(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/[.!?]+$/g, "").toLowerCase();
}

function assertionFor(sentence: RookContactDraftSentence) {
  const text = normalizeRookContactText(sentence.text);
  const byText = ROOK_CONTACT_BUSINESS_ASSERTIONS.find(
    item => normalizeRookContactText(item.text) === text
  );
  if (byText) return byText;
  if (!sentence.claimKey) return null;
  return ROOK_CONTACT_BUSINESS_ASSERTIONS.find(item => item.claimKey === sentence.claimKey) ?? null;
}

function evidenceMatches(
  sentence: RookContactDraftSentence,
  claimKey: string,
  evidence: RookContactEvidence
): boolean {
  if (evidence.claimKey !== claimKey) return false;
  if (sentence.evidenceReferenceId && evidence.id !== sentence.evidenceReferenceId) return false;
  return normalizeRookContactText(evidence.displayValue) === normalizeRookContactText(sentence.text);
}

function groundedBase(
  sentence: RookContactDraftSentence,
  patch: Pick<RookContactGroundedSentence, "label" | "claimKey" | "blocked" | "authority" | "verifiedAccountFact">
): RookContactGroundedSentence {
  return {
    text: sentence.text,
    capabilityId: ROOK_CONTACT_CAPABILITY_ID,
    implementationCapabilityId: ROOK_OUTREACH_DRAFTING_CAPABILITY_ID,
    ...patch,
  };
}

/**
 * Assigns labels from server evidence. proposedLabel is not authority.
 * A communication receipt does not prove a business assertion.
 * General guidance does not become a verified account fact.
 */
export function groundRookContactLanguage(input: {
  sentences: readonly RookContactDraftSentence[];
  evidence: readonly RookContactEvidence[];
}): RookContactGroundedSentence[] {
  return input.sentences.map(sentence => {
    const character =
      normalizeRookContactText(sentence.text) === normalizeRookContactText(CHARACTER_LINES[0]) &&
      !sentence.claimKey;
    if (character) {
      return groundedBase(sentence, {
        label: "MODEL_PHRASING",
        claimKey: null,
        blocked: false,
        authority: false,
        verifiedAccountFact: false,
      });
    }

    const assertion = assertionFor(sentence);
    if (assertion) {
      const accountFact = input.evidence.find(
        item =>
          ACCOUNT_FACT_SOURCES.has(item.sourceType) &&
          evidenceMatches(sentence, assertion.claimKey, item) &&
          normalizeRookContactText(item.displayValue) === normalizeRookContactText(assertion.text)
      );
      if (accountFact) {
        return groundedBase(sentence, {
          label: "VERIFIED",
          claimKey: assertion.claimKey,
          blocked: false,
          authority: "evidence",
          verifiedAccountFact: true,
        });
      }
      return groundedBase(sentence, {
        label: "UNKNOWN",
        claimKey: assertion.claimKey,
        blocked: true,
        authority: false,
        verifiedAccountFact: false,
      });
    }

    const claimKey = sentence.claimKey?.trim() || null;
    if (claimKey) {
      const matched = input.evidence.find(item => evidenceMatches(sentence, claimKey, item));
      if (matched?.sourceType === "general_guidance") {
        return groundedBase(sentence, {
          label: "GENERAL_GUIDANCE",
          claimKey,
          blocked: false,
          authority: false,
          verifiedAccountFact: false,
        });
      }
      if (matched && ACCOUNT_FACT_SOURCES.has(matched.sourceType)) {
        return groundedBase(sentence, {
          label: "GROUNDED",
          claimKey,
          blocked: false,
          authority: "evidence",
          verifiedAccountFact: true,
        });
      }
    }

    return groundedBase(sentence, {
      label: "UNKNOWN",
      claimKey,
      blocked: false,
      authority: false,
      verifiedAccountFact: false,
    });
  });
}

export function canonicalContactEvidence(input: {
  accountId: number;
  accountName: string;
  contactId: number;
  contactName: string | null;
  contactTitle: string | null;
}): RookContactEvidence[] {
  const evidence: RookContactEvidence[] = [];
  const accountName = input.accountName.trim();
  if (accountName) {
    evidence.push({
      id: `account:${input.accountId}:name`,
      claimKey: "account_name",
      displayValue: accountName,
      sourceType: "canonical_account",
    });
  }
  const contactName = input.contactName?.trim() ?? "";
  if (contactName) {
    evidence.push({
      id: `contact:${input.contactId}:name`,
      claimKey: "contact_name",
      displayValue: contactName,
      sourceType: "canonical_contact",
    });
  }
  const contactTitle = input.contactTitle?.trim() ?? "";
  if (contactTitle) {
    evidence.push({
      id: `contact:${input.contactId}:title`,
      claimKey: "contact_title",
      displayValue: contactTitle,
      sourceType: "canonical_contact",
    });
  }
  return evidence;
}
