import type {
  ActivityStatus,
  BusinessUnderstanding,
  CoverageGap,
  KnowledgeQuestionView,
  KnowledgeSourceRef,
  RelationshipType,
  UnderstoodEntity,
  UnderstoodRelationship,
} from "../../shared/businessKnowledge";
import { CoverageLedger } from "../firstTenMinutes/research/coverage";
import { BUSINESS_KINDS } from "./reconcile";
import { entities, evidenceByIds, latestFinishedRun, liveAssertions, questions, type AssertionRow, type EntityRow, type KnowledgeScope, type QuestionRow } from "./store";

/**
 * The reconciled understanding, read back: what is current, what is being prepared, what has gone quiet, what is
 * past, who the person works with and how the names relate, with each conclusion's basis and sources, the questions
 * still open, and where the reading couldn't see. This is what the portrait and Claire consume. Read only.
 */

const BUCKET: Record<ActivityStatus, keyof Pick<BusinessUnderstanding, "current" | "prelaunch" | "dormant" | "historical" | "unknown">> = {
  active: "current",
  prelaunch: "prelaunch",
  dormant: "dormant",
  historical: "historical",
  abandoned: "historical",
  unknown: "unknown",
  conflicting: "unknown",
};

export function questionView(row: QuestionRow): KnowledgeQuestionView {
  return {
    id: row.id,
    kind: row.kind,
    question: row.question,
    followUp: row.status === "needs_followup" ? row.followUp : null,
    status: row.status,
    answer: row.answerText,
    explanation: row.resolutionJson?.explanation ?? null,
  };
}

export async function readBusinessUnderstanding(scope: KnowledgeScope): Promise<BusinessUnderstanding> {
  const [all, live, asked, run] = await Promise.all([entities(scope), liveAssertions(scope), questions(scope), latestFinishedRun(scope)]);
  const byId = new Map(all.map(entity => [entity.id, entity]));
  const evidence = new Map((await evidenceByIds(scope, live.flatMap(row => row.evidenceIdsJson))).map(row => [row.id, row]));
  const sourcesOf = (row: AssertionRow | undefined): KnowledgeSourceRef[] =>
    (row?.evidenceIdsJson ?? [])
      .map(id => evidence.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .slice(0, 4)
      .map(item => ({ provider: item.provider, label: item.label, excerpt: item.excerpt, at: item.occurredAt?.toISOString() ?? null, url: item.url }));

  const current = (predicate: AssertionRow["predicate"], subject: string) =>
    live.find(row => row.state === "current" && row.predicate === predicate && row.subjectEntityId === subject);
  const view = (entity: EntityRow): UnderstoodEntity => {
    const status = current("status", entity.id);
    const role = current("role", entity.id);
    return {
      id: entity.id,
      kind: entity.kind,
      name: entity.name,
      status: (status?.value as ActivityStatus | undefined) ?? null,
      statusBasis: status?.basis ?? null,
      statusWhy: status?.rationale ?? null,
      lastActivityAt: status?.effectiveFrom?.toISOString() ?? null,
      role: role?.detail ?? role?.value ?? null,
      sources: sourcesOf(status ?? role),
    };
  };

  const out: BusinessUnderstanding = {
    journeyId: scope.journeyId,
    understoodAt: run?.finishedAt?.toISOString() ?? null,
    owner: { name: null, email: null },
    current: [],
    prelaunch: [],
    dormant: [],
    historical: [],
    unknown: [],
    people: [],
    relationships: [],
    conflicts: [],
    openQuestions: [],
    resolvedQuestions: [],
    coverageGaps: [],
  };

  const operator = all.find(entity => entity.kind === "operator");
  if (operator) out.owner = { name: operator.name.includes("@") ? null : operator.name, email: operator.email };

  for (const entity of all.filter(item => BUSINESS_KINDS.includes(item.kind))) {
    const item = view(entity);
    out[BUCKET[item.status ?? "unknown"]].push(item);
  }

  const relationships = live.filter(row => row.state === "current" && row.predicate === "relationship");
  const collaborators = new Set(relationships.filter(row => row.value === "collaborates_with").map(row => row.subjectEntityId));
  for (const person of all.filter(entity => entity.kind === "person")) {
    if (collaborators.has(person.id) || current("role", person.id)) {
      const item = view(person);
      // a person's basis is that of what is known about them (their role, that they work with the owner), not a status
      const known = current("role", person.id) ?? relationships.find(row => row.value === "collaborates_with" && row.subjectEntityId === person.id);
      item.statusBasis = known?.basis ?? null;
      if (!item.sources.length) item.sources = sourcesOf(relationships.find(row => row.subjectEntityId === person.id || row.objectEntityId === person.id));
      out.people.push(item);
    }
  }

  for (const row of relationships) {
    const subject = byId.get(row.subjectEntityId);
    const object = row.objectEntityId ? byId.get(row.objectEntityId) : undefined;
    if (!subject || !object) continue;
    const relationship: UnderstoodRelationship = {
      id: row.id,
      subject: subject.name,
      type: row.value as RelationshipType,
      object: object.name,
      basis: row.basis,
      detail: row.detail,
      confidence: row.confidence,
      authorizesFinancialMerge: false,
    };
    out.relationships.push(relationship);
  }

  for (const conflict of live.filter(row => row.state === "conflict")) {
    const confirmed = live.find(row => row.state === "current" && row.claimKey === conflict.claimKey);
    const subject = byId.get(conflict.subjectEntityId);
    if (!confirmed || !subject) continue;
    out.conflicts.push({ claim: `${subject.name}: ${conflict.predicate}`, confirmed: confirmed.value, inferred: conflict.value, why: conflict.rationale });
  }

  for (const row of asked) {
    const item = questionView(row);
    if (row.status === "resolved") out.resolvedQuestions.push(item);
    else if (row.status !== "skipped") out.openQuestions.push(item);
  }

  if (run?.coverageJson) {
    out.coverageGaps = CoverageLedger.from(run.coverageJson)
      .summary()
      .filter((item): item is typeof item & { state: CoverageGap["state"] } => item.state !== "complete" && item.source !== "public_web")
      .map(item => ({ source: item.source, state: item.state, reasons: item.reasons }));
  }
  return out;
}
