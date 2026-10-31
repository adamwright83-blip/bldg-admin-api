import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";
import type {
  ActivityStatus,
  AssertionBasis,
  EntityKind,
  EventBasis,
  EvidenceProvider,
  Predicate,
  QuestionKind,
  QuestionResolution,
  TimelineKind,
  TimelineSignal,
  TimePrecision,
} from "../../shared/businessKnowledge";
import { USER_BASES } from "../../shared/businessKnowledge";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import type { CoverageEntry } from "../firstTenMinutes/research/coverage";
import { REDACTED, redactSensitive } from "../firstTenMinutes/research/privacy";
import { bkAssertions, bkEntities, bkEvidence, bkQuestions, bkRuns, bkTimeline, type ResearchRecord } from "./schema";

/**
 * The business knowledge store. Every read and write takes a KnowledgeScope and is filtered by it: a journey's rows,
 * and once the journey became a workspace, that tenant's rows only (a row stamped with another tenant never
 * matches). Ingestion is idempotent: evidence, entities and timeline events have ids derived from what they are, so
 * reading the same source twice changes nothing. Assertions are versioned: a new conclusion supersedes the current
 * one (both kept); an inference never supersedes the person's own answer, it is kept beside it as a `conflict`.
 */
export type KnowledgeScope = { journeyId: string; tenantId: string | null };

export type EntityRow = typeof bkEntities.$inferSelect;
export type EvidenceRow = typeof bkEvidence.$inferSelect;
export type TimelineRow = typeof bkTimeline.$inferSelect;
export type AssertionRow = typeof bkAssertions.$inferSelect;
export type QuestionRow = typeof bkQuestions.$inferSelect;
export type RunRow = typeof bkRuns.$inferSelect;

export async function knowledgeDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

const hashId = (...parts: Array<string | null | undefined>) =>
  createHash("sha256").update(parts.map(part => part ?? "").join("\u0000")).digest("hex").slice(0, 32);

type Scoped = { journeyId: MySqlColumn; tenantId: MySqlColumn };

/** The scope filter every query uses. */
export function inScope(table: Scoped, scope: KnowledgeScope): SQL {
  if (!scope.journeyId.trim()) throw new Error("A knowledge scope needs a journey");
  return scope.tenantId
    ? and(eq(table.journeyId, scope.journeyId), or(eq(table.tenantId, scope.tenantId), isNull(table.tenantId)))!
    : and(eq(table.journeyId, scope.journeyId), isNull(table.tenantId))!;
}

function affected(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number })?.affectedRows ?? 0);
}

const CORPORATE = /\b(llc|l\.l\.c\.|inc|incorporated|ltd|limited|co|corp|corporation|company|plc)\b\.?/g;

/** A name as a key: case, punctuation, "the" and corporate suffixes don't make a different entity. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(CORPORATE, " ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 191);
}

// ------------------------------------------------------------------ entities

export async function upsertEntity(
  scope: KnowledgeScope,
  input: { kind: EntityKind; name: string; email?: string | null; domain?: string | null; aliases?: string[]; canonicalRef?: string | null }
): Promise<string> {
  const db = await knowledgeDb();
  const key = input.kind === "person" && input.email ? input.email.toLowerCase() : nameKey(input.name);
  if (!key) throw new Error("An entity needs a name");
  const id = hashId(scope.journeyId, input.kind, key);
  const name = input.name.trim().slice(0, 255);
  try {
    await db.insert(bkEntities).values({
      id,
      journeyId: scope.journeyId,
      tenantId: scope.tenantId,
      kind: input.kind,
      name,
      nameKey: key,
      aliasesJson: input.aliases?.length ? [...new Set(input.aliases)].slice(0, 12) : null,
      email: input.email?.toLowerCase() ?? null,
      domain: input.domain ?? null,
      canonicalRef: input.canonicalRef ?? null,
    });
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
    const [existing] = await db.select().from(bkEntities).where(and(inScope(bkEntities, scope), eq(bkEntities.id, id))).limit(1);
    if (!existing) throw new Error("Entity belongs to another scope");
    const aliases = [...new Set([...(existing.aliasesJson ?? []), ...(input.aliases ?? []), ...(existing.name !== name ? [name] : [])])].slice(0, 12);
    await db
      .update(bkEntities)
      .set({
        aliasesJson: aliases.length ? aliases : null,
        email: existing.email ?? input.email?.toLowerCase() ?? null,
        domain: existing.domain ?? input.domain ?? null,
        canonicalRef: existing.canonicalRef ?? input.canonicalRef ?? null,
        // a person's display name improves when a real name appears for an address
        ...(existing.kind === "person" && existing.name.includes("@") && !name.includes("@") ? { name } : {}),
      })
      .where(and(inScope(bkEntities, scope), eq(bkEntities.id, id)));
  }
  return id;
}

export async function entities(scope: KnowledgeScope, kinds?: readonly EntityKind[]): Promise<EntityRow[]> {
  const db = await knowledgeDb();
  return db
    .select()
    .from(bkEntities)
    .where(kinds?.length ? and(inScope(bkEntities, scope), inArray(bkEntities.kind, [...kinds])) : inScope(bkEntities, scope))
    .orderBy(asc(bkEntities.createdAt));
}

export async function entityById(scope: KnowledgeScope, id: string): Promise<EntityRow | null> {
  const db = await knowledgeDb();
  const [row] = await db.select().from(bkEntities).where(and(inScope(bkEntities, scope), eq(bkEntities.id, id))).limit(1);
  return row ?? null;
}

// ------------------------------------------------------------------ evidence

export type EvidenceInput = {
  provider: EvidenceProvider;
  sourceRef: string;
  locator?: string;
  label: string;
  excerpt: string;
  url?: string | null;
  occurredAt?: Date | null;
};

/** Store what a source said: a short, redacted excerpt with where to find it again. Same source twice: one row. */
export async function recordEvidence(scope: KnowledgeScope, runId: string | null, input: EvidenceInput, now = new Date()): Promise<string> {
  const db = await knowledgeDb();
  const locator = (input.locator ?? "").slice(0, 191);
  const id = hashId(scope.journeyId, input.provider, input.sourceRef, locator);
  const excerpt = redactSensitive(input.excerpt.replace(/\s+/g, " ").trim()).slice(0, 300) || REDACTED;
  await db
    .insert(bkEvidence)
    .values({
      id,
      journeyId: scope.journeyId,
      tenantId: scope.tenantId,
      provider: input.provider,
      sourceRef: input.sourceRef.slice(0, 191),
      locator,
      label: redactSensitive(input.label).slice(0, 255),
      excerpt,
      url: input.url?.slice(0, 500) ?? null,
      occurredAt: input.occurredAt ?? null,
      discoveredAt: now,
      lastSeenAt: now,
      runId,
    })
    .onDuplicateKeyUpdate({ set: { lastSeenAt: now } });
  return id;
}

export async function evidenceByIds(scope: KnowledgeScope, ids: readonly string[]): Promise<EvidenceRow[]> {
  if (!ids.length) return [];
  const db = await knowledgeDb();
  return db.select().from(bkEvidence).where(and(inScope(bkEvidence, scope), inArray(bkEvidence.id, [...new Set(ids)])));
}

// ------------------------------------------------------------------ timeline

export type TimelineInput = {
  entityId: string;
  relatedEntityId?: string | null;
  kind: TimelineKind;
  signal: TimelineSignal;
  statedStatus?: ActivityStatus | null;
  summary: string;
  occurredAt: Date;
  occurredUntil?: Date | null;
  precision?: TimePrecision;
  evidenceId: string;
  basis: EventBasis;
  conflictsWith?: string[];
};

/** What happened, when, on which evidence. The same event from the same evidence is stored once. */
export async function recordTimelineEvent(scope: KnowledgeScope, runId: string | null, input: TimelineInput, now = new Date()): Promise<string> {
  const db = await knowledgeDb();
  const id = hashId(scope.journeyId, input.entityId, input.relatedEntityId, input.kind, input.evidenceId);
  await db
    .insert(bkTimeline)
    .values({
      id,
      journeyId: scope.journeyId,
      tenantId: scope.tenantId,
      entityId: input.entityId,
      relatedEntityId: input.relatedEntityId ?? null,
      kind: input.kind,
      signal: input.signal,
      statedStatus: input.statedStatus ?? null,
      summary: redactSensitive(input.summary).slice(0, 300),
      occurredAt: input.occurredAt,
      occurredUntil: input.occurredUntil ?? null,
      timePrecision: input.precision ?? "day",
      discoveredAt: now,
      evidenceId: input.evidenceId,
      basis: input.basis,
      conflictsWithJson: input.conflictsWith?.length ? input.conflictsWith : null,
      runId,
    })
    .onDuplicateKeyUpdate({ set: { id } });
  return id;
}

export async function timeline(scope: KnowledgeScope, filter: { entityIds?: readonly string[]; from?: Date; to?: Date } = {}): Promise<TimelineRow[]> {
  const db = await knowledgeDb();
  const clauses: SQL[] = [inScope(bkTimeline, scope)];
  if (filter.entityIds?.length) clauses.push(or(inArray(bkTimeline.entityId, [...filter.entityIds]), inArray(bkTimeline.relatedEntityId, [...filter.entityIds]))!);
  if (filter.from) clauses.push(sql`${bkTimeline.occurredAt} >= ${filter.from}`);
  if (filter.to) clauses.push(sql`${bkTimeline.occurredAt} < ${filter.to}`);
  return db.select().from(bkTimeline).where(and(...clauses)).orderBy(asc(bkTimeline.occurredAt));
}

// ------------------------------------------------------------------ assertions

export function claimKeyOf(predicate: Predicate, subjectEntityId: string, objectEntityId: string | null): string {
  // a relationship between two businesses is one claim whichever way round it was put
  if (predicate === "relationship" && objectEntityId && objectEntityId < subjectEntityId) return `${predicate}:${objectEntityId}:${subjectEntityId}`;
  return `${predicate}:${subjectEntityId}:${objectEntityId ?? ""}`;
}

export type AssertionInput = {
  subjectEntityId: string;
  predicate: Predicate;
  objectEntityId?: string | null;
  value: string;
  detail?: string | null;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  basis: AssertionBasis;
  confidence: number;
  rationale: string;
  evidenceIds: string[];
  createdBy: "reconciler" | "investigator" | "user";
  questionId?: string | null;
};

export type AssertOutcome =
  | { outcome: "created" | "superseded"; id: string; version: number }
  | { outcome: "unchanged"; id: string; version: number }
  /** an inference that disagrees with the person's answer: kept beside it, never replacing it */
  | { outcome: "conflict"; id: string; confirmedId: string };

const isUser = (basis: AssertionBasis) => USER_BASES.includes(basis);

/**
 * Record a conclusion or a fact the person gave. Never overwrites: a different value becomes a new version that
 * supersedes the current one. The person's own answer can supersede anything; an inference can supersede only
 * another inference.
 */
export async function assertClaim(scope: KnowledgeScope, input: AssertionInput): Promise<AssertOutcome> {
  if (input.value === "same_legal_entity" && !isUser(input.basis)) {
    throw new Error("Only the person's own answer can say two names are one legal entity");
  }
  const db = await knowledgeDb();
  const claimKey = claimKeyOf(input.predicate, input.subjectEntityId, input.objectEntityId ?? null);
  return db.transaction(async tx => {
    const live = await tx
      .select()
      .from(bkAssertions)
      .where(and(inScope(bkAssertions, scope), eq(bkAssertions.claimKey, claimKey), inArray(bkAssertions.state, ["current", "conflict"])))
      .orderBy(desc(bkAssertions.version))
      .for("update");
    const current = live.find(row => row.state === "current") ?? null;
    const values = {
      journeyId: scope.journeyId,
      tenantId: scope.tenantId,
      claimKey,
      subjectEntityId: input.subjectEntityId,
      predicate: input.predicate,
      objectEntityId: input.objectEntityId ?? null,
      value: input.value.slice(0, 48),
      detail: input.detail ? input.detail.slice(0, 1000) : null,
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
      basis: input.basis,
      confidence: Math.max(0, Math.min(100, Math.round(input.confidence))),
      rationale: redactSensitive(input.rationale).slice(0, 600),
      evidenceIdsJson: [...new Set(input.evidenceIds)].slice(0, 40),
      authorizesFinancialMerge: false,
      createdBy: input.createdBy,
      questionId: input.questionId ?? null,
    };
    // the same conclusion on more evidence is not a new version; a different value, basis or wording is
    const same = (row: AssertionRow) => row.value === values.value && row.basis === values.basis && (row.detail ?? null) === values.detail;

    const conflicts = live.filter(row => row.state === "conflict");
    // the same answer again settles nothing new, unless it is the person reaffirming it over a conflict: then it is
    // a new confirmation (with its own time, after the activity they just reviewed) that closes the conflict
    if (current && same(current) && !(isUser(input.basis) && conflicts.length)) return { outcome: "unchanged" as const, id: current.id, version: current.version };

    if (current && isUser(current.basis) && !isUser(input.basis)) {
      // the person's answer stands; an agreeing inference adds nothing; a disagreeing one is kept as a conflict
      if (current.value === values.value) return { outcome: "unchanged" as const, id: current.id, version: current.version };
      const existing = live.find(row => row.state === "conflict" && row.value === values.value);
      if (existing) return { outcome: "conflict" as const, id: existing.id, confirmedId: current.id };
      const id = randomUUID();
      await tx.insert(bkAssertions).values({ id, ...values, state: "conflict", version: current.version, supersedesId: null });
      return { outcome: "conflict" as const, id, confirmedId: current.id };
    }

    const id = randomUUID();
    const version = (current?.version ?? 0) + 1;
    await tx.insert(bkAssertions).values({ id, ...values, state: "current", version, supersedesId: current?.id ?? null });
    if (current) {
      await tx
        .update(bkAssertions)
        .set({ state: "superseded", supersededById: id, supersededAt: new Date() })
        .where(and(inScope(bkAssertions, scope), eq(bkAssertions.id, current.id)));
    }
    // the person settled it: inferences that disagreed with an earlier version are no longer open conflicts
    if (isUser(input.basis) && conflicts.length) {
      await tx
        .update(bkAssertions)
        .set({ state: "superseded", supersededById: id, supersededAt: new Date() })
        .where(and(inScope(bkAssertions, scope), inArray(bkAssertions.id, conflicts.map(row => row.id))));
    }
    return { outcome: current ? ("superseded" as const) : ("created" as const), id, version };
  });
}

export async function liveAssertions(scope: KnowledgeScope, filter: { predicate?: Predicate; subjectEntityId?: string } = {}): Promise<AssertionRow[]> {
  const db = await knowledgeDb();
  const clauses: SQL[] = [inScope(bkAssertions, scope), inArray(bkAssertions.state, ["current", "conflict"])];
  if (filter.predicate) clauses.push(eq(bkAssertions.predicate, filter.predicate));
  if (filter.subjectEntityId) clauses.push(eq(bkAssertions.subjectEntityId, filter.subjectEntityId));
  return db.select().from(bkAssertions).where(and(...clauses)).orderBy(asc(bkAssertions.createdAt));
}

/** Every version of one claim, oldest first: the history a correction never erases. */
export async function assertionHistory(scope: KnowledgeScope, claimKey: string): Promise<AssertionRow[]> {
  const db = await knowledgeDb();
  return db
    .select()
    .from(bkAssertions)
    .where(and(inScope(bkAssertions, scope), eq(bkAssertions.claimKey, claimKey)))
    .orderBy(asc(bkAssertions.version), asc(bkAssertions.createdAt));
}

// ------------------------------------------------------------------ questions

export type QuestionInput = {
  topicKey: string;
  kind: QuestionKind;
  entityIds: string[];
  question: string;
  why: string;
  priority: number;
  evidenceFingerprint: string;
};

/**
 * Offer a question. A topic is asked once: proposing it again is a no-op, unless it was resolved and `reopen` is set
 * because newer evidence conflicts with the answer (and the evidence has actually changed since it was asked).
 */
export async function proposeQuestion(scope: KnowledgeScope, input: QuestionInput, options: { reopen?: boolean } = {}): Promise<{ id: string; status: "created" | "exists" | "reopened" }> {
  const db = await knowledgeDb();
  const id = hashId(scope.journeyId, "question", input.topicKey);
  try {
    await db.insert(bkQuestions).values({
      id,
      journeyId: scope.journeyId,
      tenantId: scope.tenantId,
      topicKey: input.topicKey.slice(0, 191),
      kind: input.kind,
      entityIdsJson: input.entityIds,
      question: input.question.slice(0, 500),
      why: redactSensitive(input.why).slice(0, 500),
      priority: input.priority,
      status: "open",
      evidenceFingerprint: input.evidenceFingerprint.slice(0, 64),
    });
    return { id, status: "created" };
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
  }
  const [row] = await db.select().from(bkQuestions).where(and(inScope(bkQuestions, scope), eq(bkQuestions.id, id))).limit(1);
  if (!row) throw new Error("Question belongs to another scope");
  if (options.reopen && row.status === "resolved" && row.evidenceFingerprint !== input.evidenceFingerprint.slice(0, 64)) {
    await db
      .update(bkQuestions)
      .set({
        status: "open",
        question: input.question.slice(0, 500),
        why: redactSensitive(input.why).slice(0, 500),
        evidenceFingerprint: input.evidenceFingerprint.slice(0, 64),
        askedAt: null,
        followUp: null,
      })
      .where(and(inScope(bkQuestions, scope), eq(bkQuestions.id, id)));
    return { id, status: "reopened" };
  }
  return { id, status: "exists" };
}

export async function questions(scope: KnowledgeScope): Promise<QuestionRow[]> {
  const db = await knowledgeDb();
  return db.select().from(bkQuestions).where(inScope(bkQuestions, scope)).orderBy(desc(bkQuestions.priority), asc(bkQuestions.createdAt));
}

export async function questionById(scope: KnowledgeScope, id: string): Promise<QuestionRow | null> {
  const db = await knowledgeDb();
  const [row] = await db.select().from(bkQuestions).where(and(inScope(bkQuestions, scope), eq(bkQuestions.id, id))).limit(1);
  return row ?? null;
}

export async function updateQuestion(
  scope: KnowledgeScope,
  id: string,
  patch: Partial<Pick<QuestionRow, "status" | "askedAt" | "answerText" | "answeredAt" | "followUp" | "followUpAnswer">> & { resolution?: QuestionResolution | null },
  expectStatus?: readonly QuestionRow["status"][]
): Promise<boolean> {
  const db = await knowledgeDb();
  const { resolution, ...rest } = patch;
  const clauses = [inScope(bkQuestions, scope), eq(bkQuestions.id, id)];
  if (expectStatus?.length) clauses.push(inArray(bkQuestions.status, [...expectStatus]));
  const result = await db
    .update(bkQuestions)
    .set({ ...rest, ...(resolution !== undefined ? { resolutionJson: resolution } : {}) })
    .where(and(...clauses));
  return affected(result) === 1;
}

// ------------------------------------------------------------------ runs

const RUN_LEASE_MS = 5 * 60_000;

/** Take the journey's investigation. Only one runs at a time; a run whose server went away is taken over. */
export async function startRun(
  scope: KnowledgeScope,
  input: { kind: "full" | "incremental"; trigger: string; budget: Record<string, number>; model: string | null },
  now = new Date()
): Promise<string | null> {
  const db = await knowledgeDb();
  // a run whose server went away (lease lapsed) is closed as failed, which frees the journey's running slot
  await db
    .update(bkRuns)
    .set({ status: "failed", runningKey: null, finishedAt: now, notesJson: ["the server running it went away"] })
    .where(and(inScope(bkRuns, scope), eq(bkRuns.status, "running"), sql`${bkRuns.leaseUntil} < ${now}`));
  const id = randomUUID();
  try {
    // the unique (journey_id, running_key) makes this the lease: a second concurrent insert fails, atomically
    await db.insert(bkRuns).values({
      id,
      journeyId: scope.journeyId,
      tenantId: scope.tenantId,
      kind: input.kind,
      status: "running",
      runningKey: "running",
      model: input.model,
      triggerReason: input.trigger.slice(0, 200),
      startedAt: now,
      leaseUntil: new Date(now.getTime() + RUN_LEASE_MS),
      budgetJson: input.budget,
    });
  } catch (error) {
    if (isMysqlDuplicateKeyError(error)) return null;
    throw error;
  }
  return id;
}

export async function renewRun(scope: KnowledgeScope, runId: string): Promise<void> {
  const db = await knowledgeDb();
  await db.update(bkRuns).set({ leaseUntil: new Date(Date.now() + RUN_LEASE_MS) }).where(and(inScope(bkRuns, scope), eq(bkRuns.id, runId)));
}

export async function finishRun(
  scope: KnowledgeScope,
  runId: string,
  result: {
    status: "complete" | "failed" | "budget_exhausted";
    used: Record<string, number>;
    coverage: readonly CoverageEntry[];
    research: ResearchRecord[];
    notes: string[];
    watermarkAt: Date | null;
  }
): Promise<void> {
  const db = await knowledgeDb();
  await db
    .update(bkRuns)
    .set({
      status: result.status,
      runningKey: null,
      finishedAt: new Date(),
      leaseUntil: null,
      usedJson: result.used,
      coverageJson: [...result.coverage].slice(-600),
      researchJson: result.research.slice(0, 80),
      notesJson: result.notes.slice(0, 40),
      watermarkAt: result.watermarkAt,
    })
    .where(and(inScope(bkRuns, scope), eq(bkRuns.id, runId)));
}

export async function runs(scope: KnowledgeScope, limit = 10): Promise<RunRow[]> {
  const db = await knowledgeDb();
  return db.select().from(bkRuns).where(inScope(bkRuns, scope)).orderBy(desc(bkRuns.startedAt)).limit(limit);
}

/** The newest finished run (complete or out of budget): what the understanding currently rests on. */
export async function latestFinishedRun(scope: KnowledgeScope): Promise<RunRow | null> {
  return (await runs(scope, 20)).find(run => run.status === "complete" || run.status === "budget_exhausted") ?? null;
}

// ------------------------------------------------------------------ tenancy, retention

const TABLES = [bkEntities, bkEvidence, bkTimeline, bkAssertions, bkQuestions, bkRuns] as const;

/** The journey became a workspace: stamp its knowledge with the tenant, so tenant reads can require it. */
export async function bindKnowledgeTenant(journeyId: string, tenantId: string): Promise<void> {
  if (!journeyId.trim() || !tenantId.trim()) throw new Error("Binding needs a journey and a tenant");
  const db = await knowledgeDb();
  for (const table of TABLES) {
    await db.update(table).set({ tenantId }).where(and(eq(table.journeyId, journeyId), isNull(table.tenantId)));
  }
}

/**
 * Forget everything known for a scope: entities, evidence excerpts, timeline, assertions (with their history),
 * questions and answers, runs. Used when the person disconnects their sources and asks to be forgotten, and for
 * journeys whose signup draft expired without becoming a workspace. Nothing outside business knowledge is touched.
 */
export async function forgetKnowledge(scope: KnowledgeScope): Promise<void> {
  const db = await knowledgeDb();
  for (const table of TABLES) await db.delete(table).where(inScope(table, scope));
}
