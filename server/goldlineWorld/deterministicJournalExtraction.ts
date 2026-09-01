/**
 * A deterministic stand-in for LLM Field Journal extraction, for proof runs.
 *
 * This is not a cheaper extractor — it is a fixture. It recognises only the
 * shapes a proof transcript is written to contain, and it deliberately does
 * less than the real extractor rather than guessing more. Anything it cannot
 * read with certainty it omits, so a proof can never demonstrate a capability
 * the real pipeline does not have.
 *
 * Provenance follows the same rule the real extractor uses. A physical feature
 * the driver describes in their own words is `operator_observed` — they were
 * standing there. An identity claim like a property name or an address is
 * `operator_reported`, because the driver is repeating something rather than
 * verifying it. Confidence stays `low` throughout and every item carries a
 * transcript excerpt, so a fixture can never masquerade as provider truth.
 */

import {
  EMPTY_FIELD_JOURNAL_EXTRACTION,
  parseFieldJournalExtraction,
  type FieldJournalExtraction,
} from "../../shared/fieldJournal";
import { assertProofModeAllowed } from "../_core/proofMode";
import { classifyTranscriptClaims } from "../../shared/goldlineTemporal";

/** Street suffixes a proof transcript may use; enough to spot an address. */
const STREET_SUFFIX =
  "(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|way|place|pl|court|ct|lane|ln|terrace|circle|cir)";

const ADDRESS = new RegExp(
  `\\b(\\d{2,6}\\s+(?:[NSEW]\\.?\\s+)?[A-Za-z][A-Za-z'.-]*(?:\\s+[A-Za-z][A-Za-z'.-]*){0,4}\\s+${STREET_SUFFIX}\\b\\.?)`,
  "i"
);

/**
 * "at The Louise", "visited Meridian Court" — a capitalised property name
 * introduced by a preposition or a visit verb. Anything less explicit is left
 * alone rather than guessed at.
 */
const PROPERTY_NAME =
  /\b(?:[Aa]t|[Tt]o|[Vv]isited|[Ss]topped by|[Dd]ropped by|[Cc]alled on|[Tt]oured)\s+((?:[Tt]he\s+)?[A-Z][A-Za-z'&.-]*(?:\s+[A-Z][A-Za-z'&.-]*){0,3})/;

const ACTION_PATTERNS: Array<{
  type: FieldJournalExtraction["actions"][number]["type"];
  pattern: RegExp;
}> = [
  { type: "visited", pattern: /\b(?:visited|stopped by|dropped by|walked into|toured)\b/i },
  { type: "visit_attempted", pattern: /\b(?:tried to visit|nobody answered|no answer|door was locked)\b/i },
  { type: "called", pattern: /\b(?:called|phoned|rang)\b/i },
  { type: "texted", pattern: /\b(?:texted|sent a text)\b/i },
  { type: "emailed", pattern: /\b(?:emailed|sent an email)\b/i },
  { type: "collateral_delivered", pattern: /\b(?:left|dropped off)\s+(?:a\s+)?(?:flyer|brochure|card|packet)\b/i },
  { type: "proposal_sent", pattern: /\b(?:sent|delivered)\s+(?:the\s+|a\s+)?proposal\b/i },
  { type: "spoke_with_contact", pattern: /\b(?:spoke with|talked to|met with)\b/i },
];

const AMENITY_WORDS = [
  "courtyard", "rooftop", "roof deck", "pool", "gym", "valet", "concierge",
  "garage", "lobby", "terrace", "garden",
];

const ARCHITECTURE_WORDS = [
  "brick", "stucco", "art deco", "mid-century", "glass tower", "spanish tile",
  "terracotta", "high-rise", "low-rise", "bungalow", "columns", "archway",
];

function excerpt(transcript: string, match: string): string {
  const index = transcript.toLowerCase().indexOf(match.toLowerCase());
  if (index < 0) return match.slice(0, 200);
  return transcript.slice(Math.max(0, index - 40), index + match.length + 40).trim().slice(0, 200);
}

function evidence(
  transcript: string,
  value: string,
  provenance: "operator_observed" | "operator_reported"
) {
  return {
    value: value.trim().slice(0, 1000),
    provenance,
    confidence: "low" as const,
    transcriptExcerpt: excerpt(transcript, value),
  };
}

/** An identity claim the driver is repeating rather than verifying. */
const reported = (transcript: string, value: string) =>
  evidence(transcript, value, "operator_reported");

/** A physical feature the driver described from where they were standing. */
const observed = (transcript: string, value: string) =>
  evidence(transcript, value, "operator_observed");

function findAll(transcript: string, words: string[]) {
  const lower = transcript.toLowerCase();
  return words
    .filter(word => lower.includes(word))
    .slice(0, 20)
    .map(word => observed(transcript, word));
}

export function extractFieldJournalDeterministically(
  transcript: string,
  /** The journal's capture date, so relative time resolves the way it would live. */
  anchorDate: string = new Date().toISOString().slice(0, 10)
): FieldJournalExtraction {
  assertProofModeAllowed("Deterministic Field Journal extraction");
  const text = transcript.trim();
  if (text.length < 20) return EMPTY_FIELD_JOURNAL_EXTRACTION;

  const nameMatch = PROPERTY_NAME.exec(text);
  const addressMatch = ADDRESS.exec(text);
  const propertyName = nameMatch?.[1]?.trim() ?? null;
  const addressClue = addressMatch?.[1]?.trim() ?? null;

  // With neither a name nor an address there is no entity to speak of, and
  // inventing a key would be exactly the fabrication this fixture must avoid.
  if (!propertyName && !addressClue)
    return parseFieldJournalExtraction({
      ...EMPTY_FIELD_JOURNAL_EXTRACTION,
      coaching: EMPTY_FIELD_JOURNAL_EXTRACTION.coaching,
    });

  /**
   * The client key is derived from what the transcript said, not from a random
   * value, so re-reading the same transcript is stable. It is explicitly NOT an
   * identity decision — the resolver still owns whether this is a new building.
   */
  const clientEntityKey = `deterministic:${(addressClue ?? propertyName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100)}`;

  const actions = ACTION_PATTERNS.filter(item => item.pattern.test(text))
    .slice(0, 30)
    .map(item => ({
      entityClientKey: clientEntityKey,
      type: item.type,
      evidence: reported(text, item.pattern.exec(text)?.[0] ?? item.type),
      occurredAtText: null,
    }));

  return parseFieldJournalExtraction({
    entities: [
      {
        clientEntityKey,
        kind: "potential_property",
        propertyName: propertyName ? reported(text, propertyName) : null,
        addressClue: addressClue ? reported(text, addressClue) : null,
        neighborhood: null,
        websiteDomain: null,
        contactName: null,
        contactTitle: null,
        email: null,
        phone: null,
        amenities: findAll(text, AMENITY_WORDS),
        architecture: findAll(text, ARCHITECTURE_WORDS),
      },
    ],
    actions,
    /*
      Time-bearing claims, read deterministically. This is the same fallback
      path the real pipeline uses when no intelligence provider answered, so a
      proof run exercises the production shape rather than a special case.
    */
    temporalClaims: classifyTranscriptClaims(text, anchorDate).map(claim => ({
      entityClientKey: clientEntityKey,
      kind: claim.kind === "authoritative_commitment" ? "operator_commitment" : claim.kind,
      sourceText: claim.sourceText,
      subject: claim.subject,
      promisedTo: claim.promisedTo,
      when: claim.when
        ? {
            text: claim.when.sourceText,
            startDate: claim.when.startDate,
            endDate: claim.when.endDate,
            daypart: claim.when.daypart,
            precision: claim.when.precision,
            hedged: claim.when.hedged,
            recurring: claim.when.recurring,
          }
        : null,
    })),
    // A fixture reports no outcomes at all. Wins, losses, interest and
    // reorders are exactly the claims that must never come from a stand-in.
    outcomes: [],
    followUps: [],
    coaching: EMPTY_FIELD_JOURNAL_EXTRACTION.coaching,
    corrections: [],
  });
}
