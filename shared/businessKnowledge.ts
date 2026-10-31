/**
 * The shapes of JOYSTICK's business knowledge: the time-aware understanding of a person's businesses, brands,
 * products, projects and the people in their working life (server/businessKnowledge/).
 *
 * Kinds of truth are never mixed: `evidence` is what a source said; a timeline event is what happened according to
 * evidence; an assertion is a conclusion (inferred) or a fact the person gave (user_confirmed / user_corrected).
 * Business knowledge is not accounting: nothing here is a transaction, and no relationship authorises merging
 * financial records.
 */

export const ENTITY_KINDS = ["operator", "company", "brand", "product", "project", "person", "organization"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Where a piece of evidence came from. `user` is the person's own answer to a question. */
export type EvidenceProvider = "gmail" | "drive" | "docs" | "sheets" | "calendar" | "public_web" | "user";

export const ACTIVITY_STATUSES = ["active", "prelaunch", "dormant", "historical", "abandoned", "unknown", "conflicting"] as const;
/**
 * active: evidence of the owner doing this work recently.
 * prelaunch: recent planning / development / launch preparation, with no verified launch or sales.
 * dormant: did happen; no comparable activity in a period that was actually searched. Not "ended".
 * historical: completed, or confirmed by the person as past.
 * abandoned: only when the person said so, or a source explicitly says it was stopped.
 * unknown: not enough evidence, or the period after the last evidence couldn't be searched.
 * conflicting: evidence disagrees and nothing resolves it yet.
 */
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const RELATIONSHIP_TYPES = [
  /** a brand or trading name used by a company */
  "brand_of",
  /** two names for related operations whose legal / accounting relationship is not established */
  "related_operation",
  "separate_business",
  /** only ever from the person's own explicit answer */
  "same_legal_entity",
  "product_of",
  /** a game, module or feature that belongs to a product */
  "part_of",
  "operates",
  "collaborates_with",
  "works_at",
  "customer_of",
  "prospect_of",
  "unknown_relation",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export type Predicate = "status" | "relationship" | "role";

/**
 * observed: stated directly by a source ("Operations lead: Dmitri").
 * inferred: concluded by JOYSTICK from dated evidence (chronology.ts).
 * user_confirmed: the person said it is so.
 * user_corrected: the person said something else is so.
 */
export type AssertionBasis = "observed" | "inferred" | "user_confirmed" | "user_corrected";
export const USER_BASES: readonly AssertionBasis[] = ["user_confirmed", "user_corrected"];

/** current: the live version. superseded: replaced by a later version (kept). conflict: an inference that disagrees
 * with the person's own answer; kept beside it, never replacing it, until the person resolves it. */
export type AssertionState = "current" | "superseded" | "conflict";

export type TimelineSignal =
  /** the owner did something: sent, invoiced, scheduled, wrote */
  | "owner_action"
  /** someone else did something with the owner: replied, attended */
  | "counterpart_action"
  /** the name is mentioned, nothing more */
  | "mention"
  /** a file's modification time or similar: never proof of activity on its own */
  | "metadata";

export type TimelineKind =
  | "proposal"
  | "correspondence"
  | "operations"
  | "invoice"
  | "meeting"
  | "document"
  | "spreadsheet"
  | "planning"
  | "launch_preparation"
  | "sale"
  | "launch"
  | "collaboration"
  | "status_statement"
  | "person_statement";

export type TimePrecision = "day" | "month" | "year" | "range";
export type EventBasis = "direct" | "inferred" | "user_confirmed";

export type QuestionKind = "relationship" | "status" | "role" | "conflict";
export type QuestionStatus = "open" | "asked" | "needs_followup" | "resolved" | "skipped";

/** What a question resolves to, as Claire can explain it back. */
export type QuestionResolution = {
  interpretation: string;
  assertionIds: string[];
  /** plain words Claire says back after the answer */
  explanation: string;
};

/** One question for the person, as the page shows it: one at a time, in Claire's voice. */
export type KnowledgeQuestionView = {
  id: string;
  kind: QuestionKind;
  question: string;
  /** asked again, narrower, after an answer that didn't settle it */
  followUp: string | null;
  status: QuestionStatus;
  /** what the person already said, when they're being asked a follow-up */
  answer: string | null;
  /** what Claire understood, once resolved */
  explanation: string | null;
};

export type KnowledgeSourceRef = {
  provider: EvidenceProvider;
  label: string;
  excerpt: string;
  at: string | null;
  url: string | null;
};

export type UnderstoodEntity = {
  id: string;
  kind: EntityKind;
  name: string;
  status: ActivityStatus | null;
  /** how the status was reached: inferred from evidence, or the person's own answer */
  statusBasis: AssertionBasis | null;
  statusWhy: string | null;
  lastActivityAt: string | null;
  role: string | null;
  sources: KnowledgeSourceRef[];
};

export type UnderstoodRelationship = {
  id: string;
  subject: string;
  type: RelationshipType;
  object: string;
  basis: AssertionBasis;
  /** the person's own words, when they gave them */
  detail: string | null;
  confidence: number;
  /** always false: knowledge never authorises merging financial records */
  authorizesFinancialMerge: false;
};

export type CoverageGap = { source: string; state: "partial" | "failed" | "not_granted" | "not_attempted"; reasons: string[] };

/** The reconciled understanding, as the portrait and Claire read it. */
export type BusinessUnderstanding = {
  journeyId: string;
  /** when the last investigation finished */
  understoodAt: string | null;
  owner: { name: string | null; email: string | null };
  current: UnderstoodEntity[];
  prelaunch: UnderstoodEntity[];
  dormant: UnderstoodEntity[];
  historical: UnderstoodEntity[];
  unknown: UnderstoodEntity[];
  people: UnderstoodEntity[];
  relationships: UnderstoodRelationship[];
  /** a person's confirmation and a later inference disagree: kept side by side */
  conflicts: Array<{ claim: string; confirmed: string; inferred: string; why: string }>;
  openQuestions: KnowledgeQuestionView[];
  resolvedQuestions: KnowledgeQuestionView[];
  coverageGaps: CoverageGap[];
};
