import { z } from "zod";

export const fieldJournalProvenanceSchema = z.enum([
  "operator_observed",
  "operator_reported",
  "device_location",
  "provider_verified",
  "official_property_source",
  "existing_business_record",
  "derived",
  "generated_game_fiction",
]);

const evidenceItem = z.object({
  value: z.string().trim().min(1).max(1000),
  provenance: fieldJournalProvenanceSchema,
  confidence: z.enum(["high", "medium", "low", "unknown"]),
  transcriptExcerpt: z.string().trim().max(500).nullable(),
});

export const extractedJournalEntitySchema = z.object({
  clientEntityKey: z.string().trim().min(1).max(128),
  kind: z.enum(["potential_property", "existing_property", "management_company", "person"]),
  propertyName: evidenceItem.nullable(),
  addressClue: evidenceItem.nullable(),
  neighborhood: evidenceItem.nullable(),
  websiteDomain: evidenceItem.nullable(),
  contactName: evidenceItem.nullable(),
  contactTitle: evidenceItem.nullable(),
  email: evidenceItem.nullable(),
  phone: evidenceItem.nullable(),
  amenities: z.array(evidenceItem).max(20),
  architecture: z.array(evidenceItem).max(20),
});

export const extractedJournalActionSchema = z.object({
  entityClientKey: z.string().trim().min(1).max(128).nullable(),
  type: z.enum([
    "visited",
    "visit_attempted",
    "called",
    "texted",
    "emailed",
    "collateral_delivered",
    "proposal_sent",
    "spoke_with_contact",
    "return_scheduled",
    "other",
  ]),
  evidence: evidenceItem,
  occurredAtText: z.string().trim().max(200).nullable(),
});

export const fieldJournalExtractionSchema = z.object({
  entities: z.array(extractedJournalEntitySchema).max(20),
  actions: z.array(extractedJournalActionSchema).max(30),
  outcomes: z.array(z.object({
    entityClientKey: z.string().trim().min(1).max(128).nullable(),
    type: z.enum([
      "manager_unavailable",
      "asked_to_return",
      "interested_reported",
      "declined",
      "proposal_requested",
      "verbal_yes_reported",
      "account_won_reported",
      "account_lost_reported",
      "customer_promised_order",
      "reorder_discussed",
      "other",
    ]),
    evidence: evidenceItem,
    /** True only means the transcript explicitly reports it; never provider verification. */
    explicitlyReported: z.boolean(),
  })).max(30),
  /**
   * Time-bearing claims the intelligence provider read out of the transcript.
   *
   * The provider is the one doing the language understanding — it sees the
   * messy sentence, the pronouns and the asides. What it returns is a
   * *proposal*: every claim is re-checked against the deterministic temporal
   * contract before anything is projected, so a provider can never talk
   * Goldline into an appointment or a promise the operator did not make.
   */
  temporalClaims: z.array(z.object({
    entityClientKey: z.string().trim().min(1).max(128).nullable(),
    kind: z.enum([
      "reported_availability",
      "operator_commitment",
      "operator_intent",
      "suggested_action",
      "uncertain_possibility",
    ]),
    /** The exact words this was read from. Required, so it can be re-checked. */
    sourceText: z.string().trim().min(1).max(1000),
    subject: z.string().trim().min(1).max(500),
    promisedTo: z.string().trim().max(120).nullable(),
    when: z.object({
      /** The time words as spoken, e.g. "Wednesday morning". */
      text: z.string().trim().max(200),
      startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      daypart: z.enum(["morning", "afternoon", "evening", "night"]).nullable(),
      precision: z.enum(["none", "window", "day", "daypart", "time"]),
      hedged: z.boolean(),
      recurring: z.boolean(),
    }).nullable(),
  })).max(30).default([]),
  followUps: z.array(z.object({
    entityClientKey: z.string().trim().min(1).max(128).nullable(),
    requestedAction: evidenceItem,
    explicitDateText: z.string().trim().max(200).nullable(),
  })).max(30),
  coaching: z.object({
    objections: z.array(evidenceItem).max(20),
    worked: z.array(evidenceItem).max(20),
    failed: z.array(evidenceItem).max(20),
    reflections: z.array(evidenceItem).max(20),
  }),
  corrections: z.array(z.object({
    statement: evidenceItem,
    correctedSourceReference: z.string().trim().max(512).nullable(),
  })).max(20),
});

export type FieldJournalExtraction = z.infer<typeof fieldJournalExtractionSchema>;

export const EMPTY_FIELD_JOURNAL_EXTRACTION: FieldJournalExtraction = {
  entities: [],
  actions: [],
  outcomes: [],
  temporalClaims: [],
  followUps: [],
  coaching: { objections: [], worked: [], failed: [], reflections: [] },
  corrections: [],
};

export const FIELD_JOURNAL_EXTRACTION_SCHEMA_VERSION = "goldline-field-journal-v2";

export function parseFieldJournalExtraction(value: unknown): FieldJournalExtraction {
  return fieldJournalExtractionSchema.parse(value);
}
