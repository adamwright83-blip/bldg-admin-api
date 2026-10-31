import { boolean, index, int, json, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import type {
  ActivityStatus,
  AssertionBasis,
  AssertionState,
  EntityKind,
  EventBasis,
  EvidenceProvider,
  Predicate,
  QuestionKind,
  QuestionResolution,
  QuestionStatus,
  TimelineKind,
  TimelineSignal,
  TimePrecision,
} from "../../shared/businessKnowledge";
import type { CoverageEntry } from "../firstTenMinutes/research/coverage";

/** drizzle/0163_business_knowledge.sql, applied by scripts/migrate.mjs. See that file for what each table owns. */

export const bkEntities = mysqlTable(
  "business_knowledge_entities",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    journeyId: varchar("journey_id", { length: 36 }).notNull(),
    tenantId: varchar("tenant_id", { length: 64 }),
    kind: varchar("kind", { length: 24 }).$type<EntityKind>().notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    nameKey: varchar("name_key", { length: 191 }).notNull(),
    aliasesJson: json("aliases_json").$type<string[] | null>(),
    email: varchar("email", { length: 320 }),
    domain: varchar("domain", { length: 191 }),
    /** a link to an existing canonical row (e.g. "commercial_account:12"), never a copy of it */
    canonicalRef: varchar("canonical_ref", { length: 191 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    name: uniqueIndex("uq_bk_entities_name").on(table.journeyId, table.kind, table.nameKey),
    tenant: index("idx_bk_entities_tenant").on(table.tenantId, table.journeyId),
  })
);

export const bkEvidence = mysqlTable(
  "business_knowledge_evidence",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    journeyId: varchar("journey_id", { length: 36 }).notNull(),
    tenantId: varchar("tenant_id", { length: 64 }),
    provider: varchar("provider", { length: 16 }).$type<EvidenceProvider>().notNull(),
    sourceRef: varchar("source_ref", { length: 191 }).notNull(),
    locator: varchar("locator", { length: 191 }).notNull().default(""),
    label: varchar("label", { length: 255 }).notNull(),
    excerpt: varchar("excerpt", { length: 500 }).notNull(),
    url: varchar("url", { length: 500 }),
    occurredAt: timestamp("occurred_at"),
    discoveredAt: timestamp("discovered_at").notNull(),
    lastSeenAt: timestamp("last_seen_at").notNull(),
    runId: varchar("run_id", { length: 36 }),
  },
  table => ({
    source: uniqueIndex("uq_bk_evidence_source").on(table.journeyId, table.provider, table.sourceRef, table.locator),
    tenant: index("idx_bk_evidence_tenant").on(table.tenantId, table.journeyId),
  })
);

export const bkTimeline = mysqlTable(
  "business_knowledge_timeline",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    journeyId: varchar("journey_id", { length: 36 }).notNull(),
    tenantId: varchar("tenant_id", { length: 64 }),
    entityId: varchar("entity_id", { length: 36 }).notNull(),
    relatedEntityId: varchar("related_entity_id", { length: 36 }),
    kind: varchar("kind", { length: 32 }).$type<TimelineKind>().notNull(),
    signal: varchar("signal", { length: 24 }).$type<TimelineSignal>().notNull(),
    /** a status_statement's stated status ("Status: prelaunch"), as the source put it */
    statedStatus: varchar("stated_status", { length: 16 }).$type<ActivityStatus | null>(),
    summary: varchar("summary", { length: 300 }).notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
    occurredUntil: timestamp("occurred_until"),
    timePrecision: varchar("time_precision", { length: 8 }).$type<TimePrecision>().notNull(),
    discoveredAt: timestamp("discovered_at").notNull(),
    evidenceId: varchar("evidence_id", { length: 36 }).notNull(),
    basis: varchar("basis", { length: 16 }).$type<EventBasis>().notNull(),
    conflictsWithJson: json("conflicts_with_json").$type<string[] | null>(),
    runId: varchar("run_id", { length: 36 }),
  },
  table => ({
    entity: index("idx_bk_timeline_entity").on(table.journeyId, table.entityId, table.occurredAt),
    tenant: index("idx_bk_timeline_tenant").on(table.tenantId, table.journeyId),
  })
);

export const bkAssertions = mysqlTable(
  "business_knowledge_assertions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    journeyId: varchar("journey_id", { length: 36 }).notNull(),
    tenantId: varchar("tenant_id", { length: 64 }),
    claimKey: varchar("claim_key", { length: 191 }).notNull(),
    subjectEntityId: varchar("subject_entity_id", { length: 36 }).notNull(),
    predicate: varchar("predicate", { length: 16 }).$type<Predicate>().notNull(),
    objectEntityId: varchar("object_entity_id", { length: 36 }),
    value: varchar("value", { length: 48 }).notNull(),
    detail: varchar("detail", { length: 1000 }),
    effectiveFrom: timestamp("effective_from"),
    effectiveTo: timestamp("effective_to"),
    basis: varchar("basis", { length: 16 }).$type<AssertionBasis>().notNull(),
    confidence: int("confidence").notNull(),
    rationale: varchar("rationale", { length: 600 }).notNull(),
    evidenceIdsJson: json("evidence_ids_json").$type<string[]>().notNull(),
    authorizesFinancialMerge: boolean("authorizes_financial_merge").notNull().default(false),
    state: varchar("state", { length: 16 }).$type<AssertionState>().notNull(),
    version: int("version").notNull(),
    supersedesId: varchar("supersedes_id", { length: 36 }),
    supersededById: varchar("superseded_by_id", { length: 36 }),
    supersededAt: timestamp("superseded_at"),
    createdBy: varchar("created_by", { length: 24 }).$type<"reconciler" | "investigator" | "user">().notNull(),
    questionId: varchar("question_id", { length: 36 }),
    createdAt: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
  },
  table => ({
    claim: index("idx_bk_assertions_claim").on(table.journeyId, table.claimKey, table.state),
    subject: index("idx_bk_assertions_subject").on(table.journeyId, table.subjectEntityId),
    tenant: index("idx_bk_assertions_tenant").on(table.tenantId, table.journeyId),
  })
);

export const bkQuestions = mysqlTable(
  "business_knowledge_questions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    journeyId: varchar("journey_id", { length: 36 }).notNull(),
    tenantId: varchar("tenant_id", { length: 64 }),
    topicKey: varchar("topic_key", { length: 191 }).notNull(),
    kind: varchar("kind", { length: 24 }).$type<QuestionKind>().notNull(),
    entityIdsJson: json("entity_ids_json").$type<string[]>().notNull(),
    question: varchar("question", { length: 500 }).notNull(),
    why: varchar("why", { length: 500 }).notNull(),
    priority: int("priority").notNull(),
    status: varchar("status", { length: 16 }).$type<QuestionStatus>().notNull(),
    evidenceFingerprint: varchar("evidence_fingerprint", { length: 64 }).notNull(),
    askedAt: timestamp("asked_at"),
    answerText: varchar("answer_text", { length: 1000 }),
    answeredAt: timestamp("answered_at"),
    followUp: varchar("follow_up", { length: 500 }),
    followUpAnswer: varchar("follow_up_answer", { length: 1000 }),
    resolutionJson: json("resolution_json").$type<QuestionResolution | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    topic: uniqueIndex("uq_bk_questions_topic").on(table.journeyId, table.topicKey),
    tenant: index("idx_bk_questions_tenant").on(table.tenantId, table.journeyId),
  })
);

export type ResearchRecord = { question: string; entityIds: string[]; status: "answered" | "unanswered" | "insufficient_evidence"; searches: string[] };

export const bkRuns = mysqlTable(
  "business_knowledge_runs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    journeyId: varchar("journey_id", { length: 36 }).notNull(),
    tenantId: varchar("tenant_id", { length: 64 }),
    kind: varchar("kind", { length: 16 }).$type<"full" | "incremental">().notNull(),
    status: varchar("status", { length: 24 }).$type<"running" | "complete" | "failed" | "budget_exhausted">().notNull(),
    /** "running" while it runs, NULL after: unique per journey, so two investigations can't run at once */
    runningKey: varchar("running_key", { length: 16 }),
    model: varchar("model", { length: 64 }),
    triggerReason: varchar("trigger_reason", { length: 200 }),
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at"),
    leaseUntil: timestamp("lease_until"),
    /** the newest source time this run considered: the next incremental run reads from here */
    watermarkAt: timestamp("watermark_at"),
    budgetJson: json("budget_json").$type<Record<string, number> | null>(),
    usedJson: json("used_json").$type<Record<string, number> | null>(),
    coverageJson: json("coverage_json").$type<CoverageEntry[] | null>(),
    researchJson: json("research_json").$type<ResearchRecord[] | null>(),
    notesJson: json("notes_json").$type<string[] | null>(),
  },
  table => ({
    running: uniqueIndex("uq_bk_runs_running").on(table.journeyId, table.runningKey),
    journey: index("idx_bk_runs_journey").on(table.journeyId, table.startedAt),
    tenant: index("idx_bk_runs_tenant").on(table.tenantId, table.journeyId),
  })
);
