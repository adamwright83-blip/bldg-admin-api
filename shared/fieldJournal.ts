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
  followUps: [],
  coaching: { objections: [], worked: [], failed: [], reflections: [] },
  corrections: [],
};

export const FIELD_JOURNAL_EXTRACTION_SCHEMA_VERSION = "goldline-field-journal-v1";

export function parseFieldJournalExtraction(value: unknown): FieldJournalExtraction {
  return fieldJournalExtractionSchema.parse(value);
}
