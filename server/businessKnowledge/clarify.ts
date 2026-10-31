import { createHash } from "node:crypto";
import type { ActivityStatus, KnowledgeQuestionView, QuestionResolution, RelationshipType } from "../../shared/businessKnowledge";
import { USER_BASES } from "../../shared/businessKnowledge";
import { collaboratorSignals } from "./reconcile";
import {
  assertClaim,
  claimKeyOf,
  entities,
  entityById,
  liveAssertions,
  proposeQuestion,
  questionById,
  questions,
  recordEvidence,
  timeline,
  updateQuestion,
  type EntityRow,
  type KnowledgeScope,
  type QuestionRow,
} from "./store";
import { questionView } from "./understanding";

/**
 * Asking the person, before the portrait is written, about what would materially change how JOYSTICK describes
 * them: how two current business names relate, whether a quiet line of work is still theirs, who an important
 * collaborator is, and anything they said earlier that newer evidence disagrees with. One question at a time, a few
 * at most during onboarding, each topic once.
 *
 * Answers are the person's own words, kept verbatim with when they said them, and recorded as user-confirmed or
 * user-corrected assertions linked to the question. An answer that doesn't settle the question ("Yes, but it's
 * complicated") gets one sensible follow-up; whatever they say then is kept in their words as a related-but-not-
 * merged relationship, never collapsed into one company. Nothing here merges records or money.
 */

export const ONBOARDING_QUESTION_LIMIT = 3;

const PRIORITY = { conflict: 95, relationship: 90, relationshipQuiet: 70, status: 80, role: 60 } as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthYear = (date: Date) => `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
const fingerprint = (...parts: string[]) => createHash("sha256").update(parts.sort().join("|")).digest("hex").slice(0, 32);
const business = (entity: EntityRow) => entity.kind === "company" || entity.kind === "brand";
const firstWord = (name: string) => name.toLowerCase().split(/\s+/)[0];

/** Offer the questions the current understanding raises. Returns the ids of questions created or reopened. */
export async function proposeQuestions(scope: KnowledgeScope, now: Date): Promise<string[]> {
  const all = await entities(scope);
  const live = await liveAssertions(scope);
  const byId = new Map(all.map(entity => [entity.id, entity]));
  const status = (id: string) => live.find(row => row.state === "current" && row.predicate === "status" && row.subjectEntityId === id);
  const created: string[] = [];
  const offer = async (...args: Parameters<typeof proposeQuestion>) => {
    const result = await proposeQuestion(...args);
    if (result.status !== "exists") created.push(result.id);
  };
  const current = (id: string) => ["active", "prelaunch"].includes(status(id)?.value ?? "");

  // ---- how two business names relate
  const pairs = new Map<string, { a: EntityRow; b: EntityRow; why: string; evidence: string[] }>();
  for (const row of live.filter(item => item.state === "current" && item.predicate === "relationship" && item.objectEntityId)) {
    const a = byId.get(row.subjectEntityId);
    const b = byId.get(row.objectEntityId!);
    if (!a || !b || !business(a) || !business(b) || USER_BASES.includes(row.basis)) continue;
    pairs.set(row.claimKey, { a, b, why: row.rationale, evidence: row.evidenceIdsJson });
  }
  const businesses = all.filter(business).filter(entity => current(entity.id));
  for (let i = 0; i < businesses.length; i += 1) {
    for (let j = i + 1; j < businesses.length; j += 1) {
      const [a, b] = [businesses[i], businesses[j]];
      const key = claimKeyOf("relationship", a.id, b.id);
      if (pairs.has(key) || firstWord(a.name) !== firstWord(b.name)) continue;
      const settled = live.some(row => row.claimKey === key && row.state === "current" && USER_BASES.includes(row.basis));
      if (!settled) pairs.set(key, { a, b, why: `Both names are in recent use and share "${a.name.split(/\s+/)[0]}".`, evidence: [] });
    }
  }
  for (const [key, pair] of pairs) {
    const settled = live.some(row => row.claimKey === key && row.state === "current" && USER_BASES.includes(row.basis));
    if (settled) continue;
    const bothCurrent = current(pair.a.id) && current(pair.b.id);
    const [first, second] = pair.a.kind === "company" || pair.b.kind !== "company" ? [pair.a, pair.b] : [pair.b, pair.a];
    await offer(scope, {
      topicKey: `relationship:${key}`,
      kind: "relationship",
      entityIds: [first.id, second.id],
      question: `I found ${bothCurrent ? "recent " : ""}work under ${first.name} and ${second.name}. Are these separate businesses, or two names for the same operation?`,
      why: pair.why,
      priority: bothCurrent ? PRIORITY.relationship : PRIORITY.relationshipQuiet,
      evidenceFingerprint: fingerprint(...pair.evidence, status(first.id)?.value ?? "", status(second.id)?.value ?? ""),
    });
  }

  // ---- whether a quiet line of work is still theirs
  const quiet = all.filter(entity => status(entity.id)?.value === "dormant" && !USER_BASES.includes(status(entity.id)!.basis));
  if (quiet.length) {
    const rows = await timeline(scope, { entityIds: quiet.map(entity => entity.id) });
    for (const entity of quiet) {
      const acts = rows.filter(row => row.entityId === entity.id && row.signal === "owner_action").sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      if (acts.length < 2) continue;
      const span = monthYear(acts[0].occurredAt) === monthYear(acts.at(-1)!.occurredAt) ? monthYear(acts[0].occurredAt) : `${monthYear(acts[0].occurredAt)} to ${monthYear(acts.at(-1)!.occurredAt)}`;
      const what = entity.kind === "project" ? entity.name.charAt(0).toLowerCase() + entity.name.slice(1) : `work for ${entity.name}`;
      await offer(scope, {
        topicKey: `status:${entity.id}`,
        kind: "status",
        entityIds: [entity.id],
        question: `I found ${what} from ${span}, but nothing like it since. Is that still something you do?`,
        why: status(entity.id)!.rationale,
        priority: PRIORITY.status,
        evidenceFingerprint: fingerprint(...acts.map(row => row.evidenceId)),
      });
    }
  }

  // ---- who an important collaborator is, when no source says
  const operator = all.find(entity => entity.kind === "operator");
  if (operator) {
    const signals = await collaboratorSignals(scope, now);
    for (const person of all.filter(entity => entity.kind === "person")) {
      const collaborates = live.some(row => row.state === "current" && row.predicate === "relationship" && row.value === "collaborates_with" && row.subjectEntityId === person.id);
      const role = live.some(row => row.state === "current" && row.predicate === "role" && row.subjectEntityId === person.id);
      if (!collaborates || role) continue;
      const signal = signals.find(item => item.personId === person.id);
      const where = signal?.sources.map(source => (source === "gmail" ? "email" : source === "drive" ? "documents" : source === "sheets" ? "spreadsheets" : source)).join(", ") ?? "work";
      await offer(scope, {
        topicKey: `role:${person.id}`,
        kind: "role",
        entityIds: [person.id],
        question: `${person.name} shows up across your ${where}. What does ${person.name.split(" ")[0]} do with you?`,
        why: `Appears in ${where}.`,
        priority: PRIORITY.role,
        evidenceFingerprint: fingerprint(...(signal?.evidenceIds ?? [])),
      });
    }
  }

  // ---- something the person said that newer evidence disagrees with
  for (const conflict of live.filter(row => row.state === "conflict")) {
    const confirmed = live.find(row => row.state === "current" && row.claimKey === conflict.claimKey);
    const subject = byId.get(conflict.subjectEntityId);
    if (!confirmed || !subject) continue;
    await offer(scope, {
      topicKey: `conflict:${conflict.id}`,
      kind: "conflict",
      entityIds: [subject.id],
      question: `Earlier you told me ${subject.name} was ${describeStatus(confirmed.value as ActivityStatus)}. Since then I've seen newer activity${conflict.rationale.match(/\d{4}-\d{2}-\d{2}/) ? `, most recently on ${conflict.rationale.match(/\d{4}-\d{2}-\d{2}/)![0]}` : ""}. Has that changed?`,
      why: conflict.rationale,
      priority: PRIORITY.conflict,
      evidenceFingerprint: fingerprint(...conflict.evidenceIdsJson),
    });
  }
  return created;
}

function describeStatus(status: ActivityStatus): string {
  switch (status) {
    case "active":
      return "current";
    case "prelaunch":
      return "still being prepared";
    case "dormant":
      return "paused";
    case "historical":
    case "abandoned":
      return "in the past";
    default:
      return "uncertain";
  }
}

/** The next question to ask, one at a time; during onboarding, only until `limit` have been asked. */
export async function nextQuestion(scope: KnowledgeScope, options: { limit?: number } = {}): Promise<KnowledgeQuestionView | null> {
  const rows = await questions(scope);
  const inProgress = rows.find(row => row.status === "needs_followup" || row.status === "asked");
  if (inProgress) return questionView(inProgress);
  const used = rows.filter(row => row.status !== "open").length;
  if (options.limit !== undefined && used >= options.limit) return null;
  const open = rows.filter(row => row.status === "open").sort((a, b) => b.priority - a.priority)[0];
  if (!open) return null;
  await updateQuestion(scope, open.id, { status: "asked", askedAt: new Date() }, ["open"]);
  return questionView({ ...open, status: "asked" });
}

export async function skipQuestion(scope: KnowledgeScope, id: string): Promise<boolean> {
  return updateQuestion(scope, id, { status: "skipped" }, ["open", "asked", "needs_followup"]);
}

// ------------------------------------------------------------------ reading an answer

export type RelationshipReading = "separate" | "trading_name" | "same_legal" | "unclear";
export type StatusReading = "active" | "historical" | "dormant" | "unclear";

const has = (text: string, pattern: RegExp) => pattern.test(text.toLowerCase());

/** Conservative: only an explicit answer is taken as one. "Yes", "kind of", "it's complicated" are unclear. */
export function readRelationshipAnswer(text: string): RelationshipReading {
  const t = text.toLowerCase();
  if (has(t, /\b(complicated|kind of|sort of|partly|partially|it depends|depends|both|sometimes|not exactly|ish)\b/)) return "unclear";
  if (has(t, /\b(same (legal )?(company|entity|llc|corporation|corp)|one (legal )?(company|entity|llc)|same legal|legally the same)\b/)) return "same_legal";
  if (has(t, /\b(separate (businesses|business|companies|company|entities)|different (businesses|companies|company|business)|not related|unrelated|nothing to do with)\b/)) return "separate";
  if (has(t, /\b(two names for|same (operation|business|thing)|trading name|trade as|trades as|brand (of|for)|is our brand|dba|doing business as|one business)\b/)) return "trading_name";
  return "unclear";
}

export function readStatusAnswer(text: string): StatusReading {
  const t = text.toLowerCase();
  if (has(t, /\b(not anymore|no longer|stopped|used to|quit|gave (it )?up|don'?t (do|build|make)|haven'?t in|in the past|retired|closed)\b/)) return "historical";
  if (has(t, /\b(paused|on hold|on a break|taking a break|not right now|for now|later|occasionally|sometimes|now and then|if someone asks)\b/)) return "dormant";
  if (has(t, /^(yes|yeah|yep|still|i do|definitely|of course)\b/) || has(t, /\b(still (do|doing|am)|currently|ongoing|every week|all the time)\b/)) return "active";
  if (has(t, /^(no|nope|nah)\b/)) return "historical";
  return "unclear";
}

const ROLE_NEGATIVE = /\b(no one|nobody|don'?t know|not really|not anymore|used to|former|no longer)\b/i;

const RELATIONSHIP_FOLLOW_UP = (a: string, b: string) =>
  `Thanks. How do ${a} and ${b} fit together? For example: one company trading under two names, two companies with the same owners, or one team running two services.`;
const STATUS_FOLLOW_UP = (what: string) => `Just so I describe it right: is ${what} something you're doing now, paused for a while, or in the past?`;

export type AnswerOutcome = { status: "resolved" | "needs_followup"; question: KnowledgeQuestionView };

/**
 * Record the person's answer, verbatim, and what it settles. A question already resolved is never re-answered here;
 * a new question (reopened on conflicting evidence) is how it would be asked again.
 */
export async function answerQuestion(scope: KnowledgeScope, id: string, text: string, now = new Date()): Promise<AnswerOutcome> {
  const words = text.trim().slice(0, 1000);
  if (!words) throw new Error("An answer needs words");
  const row = await questionById(scope, id);
  if (!row) throw new Error("No such question");
  if (row.status === "resolved" || row.status === "skipped") return { status: "resolved", question: questionView(row) };
  const followingUp = row.status === "needs_followup";
  const evidenceId = await recordEvidence(scope, null, { provider: "user", sourceRef: row.id, locator: followingUp ? "follow_up" : "answer", label: "Your answer", excerpt: words, occurredAt: now }, now);
  const said = followingUp && row.answerText ? `${row.answerText} — ${words}` : words;
  const subjects = await Promise.all(row.entityIdsJson.map(entityId => entityById(scope, entityId)));
  const [a, b] = subjects;
  if (!a) throw new Error("The question's subject is gone");

  const finish = async (resolution: QuestionResolution) => {
    await updateQuestion(scope, row.id, {
      status: "resolved",
      ...(followingUp ? { followUpAnswer: words } : { answerText: words }),
      answeredAt: now,
      resolution,
    });
    return { status: "resolved" as const, question: questionView((await questionById(scope, row.id))!) };
  };
  const followUp = async (question: string) => {
    await updateQuestion(scope, row.id, { status: "needs_followup", answerText: words, answeredAt: now, followUp: question });
    return { status: "needs_followup" as const, question: questionView((await questionById(scope, row.id))!) };
  };

  if (row.kind === "relationship" && b) {
    const reading = readRelationshipAnswer(words);
    if (reading === "unclear" && !followingUp) return followUp(RELATIONSHIP_FOLLOW_UP(a.name, b.name));
    const [brand, company] = b.kind === "brand" || a.kind === "company" ? [b, a] : [a, b];
    const decide: Record<RelationshipReading, { type: RelationshipType; subject: EntityRow; object: EntityRow; explanation: string }> = {
      separate: { type: "separate_business", subject: a, object: b, explanation: `Understood: ${a.name} and ${b.name} are separate businesses.` },
      trading_name: {
        type: "brand_of",
        subject: brand,
        object: company,
        explanation: `Got it. I'll treat ${brand.name} as a name ${company.name} works under, in your words: "${said}". That doesn't make them one legal company to me, and I won't combine their money or records.`,
      },
      same_legal: {
        type: "same_legal_entity",
        subject: a,
        object: b,
        explanation: `Understood: ${a.name} and ${b.name} are the same company. Your money and records stay exactly as they are; nothing gets combined unless you do it.`,
      },
      unclear: {
        type: "related_operation",
        subject: brand,
        object: company,
        explanation: `Thanks, that helps. I'll keep ${a.name} and ${b.name} as related but distinct, in your words: "${said}". I won't treat them as one company or combine their records; tell me if that changes.`,
      },
    };
    const choice = decide[reading];
    const result = await assertClaim(scope, {
      subjectEntityId: choice.subject.id,
      predicate: "relationship",
      objectEntityId: choice.object.id,
      value: choice.type,
      detail: said,
      basis: "user_confirmed",
      confidence: 100,
      rationale: "You said so.",
      evidenceIds: [evidenceId],
      createdBy: "user",
      questionId: row.id,
    });
    return finish({ interpretation: choice.type, assertionIds: [result.id], explanation: choice.explanation });
  }

  if (row.kind === "status" || row.kind === "conflict") {
    const reading = readStatusAnswer(words);
    const what = a.kind === "project" ? a.name.charAt(0).toLowerCase() + a.name.slice(1) : a.name;
    if (reading === "unclear" && !followingUp) return followUp(STATUS_FOLLOW_UP(what));
    if (reading === "unclear") {
      return finish({ interpretation: "unclear", assertionIds: [], explanation: `Thanks. I'll keep ${what} as uncertain, and I won't describe it as current work.` });
    }
    const value: ActivityStatus = reading;
    const result = await assertClaim(scope, {
      subjectEntityId: a.id,
      predicate: "status",
      value,
      detail: said,
      basis: reading === "historical" ? "user_corrected" : "user_confirmed",
      confidence: 100,
      rationale: "You said so.",
      evidenceIds: [evidenceId],
      createdBy: "user",
      questionId: row.id,
    });
    const explanation =
      value === "active" ? `Got it: ${what} is current work.` : value === "dormant" ? `Got it: ${what} is paused, not gone. I'll keep it in the background.` : `Got it: ${what} is in the past. I won't describe it as current work.`;
    return finish({ interpretation: value, assertionIds: [result.id], explanation });
  }

  // role
  const operator = (await entities(scope, ["operator"]))[0];
  const first = a.name.split(" ")[0];
  if (ROLE_NEGATIVE.test(words)) {
    const ids: string[] = [];
    if (operator) {
      ids.push(
        (await assertClaim(scope, { subjectEntityId: a.id, predicate: "relationship", objectEntityId: operator.id, value: "unknown_relation", detail: said, basis: "user_corrected", confidence: 100, rationale: "You said so.", evidenceIds: [evidenceId], createdBy: "user", questionId: row.id })).id
      );
    }
    return finish({ interpretation: "not_a_collaborator", assertionIds: ids, explanation: `Thanks. I won't treat ${first} as someone you currently work with.` });
  }
  const ids = [
    (await assertClaim(scope, { subjectEntityId: a.id, predicate: "role", value: "role", detail: said.slice(0, 300), basis: "user_confirmed", confidence: 100, rationale: "You said so.", evidenceIds: [evidenceId], createdBy: "user", questionId: row.id })).id,
  ];
  if (operator) {
    ids.push(
      (await assertClaim(scope, { subjectEntityId: a.id, predicate: "relationship", objectEntityId: operator.id, value: "collaborates_with", detail: said.slice(0, 300), basis: "user_confirmed", confidence: 100, rationale: "You said so.", evidenceIds: [evidenceId], createdBy: "user", questionId: row.id })).id
    );
  }
  return finish({ interpretation: "role", assertionIds: ids, explanation: `Thanks. I'll remember ${first} as: ${said}.` });
}

export type { QuestionRow };
