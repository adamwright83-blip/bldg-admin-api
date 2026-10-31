import type { ActivityStatus, EntityKind } from "../../shared/businessKnowledge";
import { USER_BASES } from "../../shared/businessKnowledge";
import { decideStatus, type ChronologyEvent, type CoverageView, type ObservedStatus, type StatusDecision } from "./chronology";
import {
  assertClaim,
  entities,
  evidenceByIds,
  liveAssertions,
  timeline,
  type AssertOutcome,
  type EntityRow,
  type KnowledgeScope,
  type TimelineRow,
} from "./store";

/**
 * Reconciliation: turn the dated timeline into current conclusions, one entity at a time, and record them as
 * versioned assertions. It never deletes and never overwrites: a changed conclusion supersedes the old one, and a
 * conclusion that disagrees with the person's own answer is kept beside it as a conflict.
 */

export const BUSINESS_KINDS: readonly EntityKind[] = ["company", "brand", "product", "project"];

export const COLLABORATION = {
  /** how recent shared work must be to count */
  recentDays: 120,
  /** distinct kinds of source (mail, documents, spreadsheets, calendar) that must show the person */
  minSources: 2,
} as const;

const DAY = 86_400_000;

export type StatusReconciliation = { entityId: string; name: string; kind: EntityKind; decision: StatusDecision; outcome: AssertOutcome | null };

async function chronologyEvents(scope: KnowledgeScope, rows: TimelineRow[]): Promise<Map<string, ChronologyEvent>> {
  const evidence = new Map((await evidenceByIds(scope, rows.map(row => row.evidenceId))).map(row => [row.id, row]));
  return new Map(
    rows.map(row => [
      row.id,
      {
        id: row.id,
        kind: row.kind,
        signal: row.signal,
        occurredAt: row.occurredAt,
        evidenceId: row.evidenceId,
        provider: evidence.get(row.evidenceId)?.provider ?? "user",
        summary: row.summary,
      },
    ])
  );
}

/** Decide every business, brand, product and project's status from its timeline and what was actually searched. */
export async function reconcileStatuses(scope: KnowledgeScope, input: { coverage: CoverageView; now: Date }): Promise<StatusReconciliation[]> {
  const subjects = await entities(scope, BUSINESS_KINDS);
  if (!subjects.length) return [];
  const rows = await timeline(scope, { entityIds: subjects.map(entity => entity.id) });
  const events = await chronologyEvents(scope, rows);
  const statuses = await liveAssertions(scope, { predicate: "status" });
  const out: StatusReconciliation[] = [];
  for (const entity of subjects) {
    const own = rows.filter(row => row.entityId === entity.id);
    const observed: ObservedStatus[] = own
      .filter(row => row.kind === "status_statement" && row.statedStatus)
      .map(row => ({ status: row.statedStatus as ActivityStatus, at: row.occurredAt, evidenceIds: [row.evidenceId], summary: row.summary }));
    const userRow = statuses.find(row => row.subjectEntityId === entity.id && row.state === "current" && USER_BASES.includes(row.basis));
    const decision = decideStatus({
      kind: entity.kind,
      events: own.filter(row => row.kind !== "status_statement").map(row => events.get(row.id)!),
      observed,
      user: userRow ? { status: userRow.value as ActivityStatus, at: userRow.createdAt, detail: userRow.detail, basis: userRow.basis } : null,
      coverage: input.coverage,
      now: input.now,
    });
    let outcome: AssertOutcome | null = null;
    if (!userRow) {
      outcome = await assertClaim(scope, {
        subjectEntityId: entity.id,
        predicate: "status",
        value: decision.status,
        basis: decision.basis,
        confidence: decision.confidence,
        rationale: decision.rationale,
        evidenceIds: decision.evidenceIds,
        effectiveFrom: decision.lastActivityAt,
        createdBy: "reconciler",
      });
    } else if (decision.conflict) {
      outcome = await assertClaim(scope, {
        subjectEntityId: entity.id,
        predicate: "status",
        value: decision.conflict.status,
        basis: "inferred",
        confidence: 60,
        rationale: decision.conflict.rationale,
        evidenceIds: decision.conflict.evidenceIds,
        createdBy: "reconciler",
      });
    }
    out.push({ entityId: entity.id, name: entity.name, kind: entity.kind, decision, outcome });
  }
  return out;
}

export type CollaboratorSignal = { personId: string; name: string; sources: string[]; recentAt: Date | null; evidenceIds: string[] };

/**
 * Who the person actually works with: people who appear across different kinds of source (mail and shared
 * documents, a spreadsheet tab, a recurring meeting) recently, however rarely they are emailed. Ranking by email
 * volume alone is how a central collaborator gets missed.
 */
export async function collaboratorSignals(scope: KnowledgeScope, now: Date): Promise<CollaboratorSignal[]> {
  const people = await entities(scope, ["person"]);
  if (!people.length) return [];
  const rows = await timeline(scope, { entityIds: people.map(person => person.id) });
  const evidence = new Map((await evidenceByIds(scope, rows.map(row => row.evidenceId))).map(row => [row.id, row]));
  const signals: CollaboratorSignal[] = [];
  for (const person of people) {
    const mine = rows.filter(row => (row.entityId === person.id || row.relatedEntityId === person.id) && row.signal !== "metadata");
    const recent = mine.filter(row => now.getTime() - row.occurredAt.getTime() <= COLLABORATION.recentDays * DAY);
    const sources = [...new Set(recent.map(row => evidence.get(row.evidenceId)?.provider).filter((provider): provider is NonNullable<typeof provider> => Boolean(provider) && provider !== "user"))]
      .map(provider => (provider === "docs" ? "drive" : provider))
      .filter((value, index, all) => all.indexOf(value) === index);
    const latest = recent.reduce<Date | null>((at, row) => (!at || row.occurredAt > at ? row.occurredAt : at), null);
    signals.push({ personId: person.id, name: person.name, sources, recentAt: latest, evidenceIds: recent.slice(-6).map(row => row.evidenceId) });
  }
  return signals.sort((a, b) => b.sources.length - a.sources.length || (b.recentAt?.getTime() ?? 0) - (a.recentAt?.getTime() ?? 0));
}

/** Record `collaborates_with` for people who meet the bar, as an inference with its sources. */
export async function reconcileCollaborators(scope: KnowledgeScope, operator: EntityRow, now: Date): Promise<CollaboratorSignal[]> {
  const signals = await collaboratorSignals(scope, now);
  const chosen = signals.filter(signal => signal.personId !== operator.id && signal.sources.length >= COLLABORATION.minSources);
  for (const signal of chosen) {
    await assertClaim(scope, {
      subjectEntityId: signal.personId,
      predicate: "relationship",
      objectEntityId: operator.id,
      value: "collaborates_with",
      basis: "inferred",
      confidence: Math.min(90, 45 + signal.sources.length * 15),
      rationale: `Appears in your ${signal.sources.join(", ")} in the last ${COLLABORATION.recentDays} days.`,
      evidenceIds: signal.evidenceIds,
      createdBy: "reconciler",
    });
  }
  return chosen;
}
