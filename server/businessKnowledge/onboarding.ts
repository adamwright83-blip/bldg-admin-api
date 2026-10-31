import type { BusinessUnderstanding, KnowledgeQuestionView, UnderstoodEntity } from "../../shared/businessKnowledge";
import type { FindingView } from "../../shared/firstTenMinutesFindings";
import { CoverageLedger } from "../firstTenMinutes/research/coverage";
import { googleResearch } from "../firstTenMinutes/research/googleResearch";
import type { PortraitKnowledge } from "../firstTenMinutes/portrait/write";
import type { JourneyRow } from "../firstTenMinutes/store";
import type { GoogleAccess } from "../firstTenMinutes/understanding/googleReaders";
import { ONBOARDING_QUESTION_LIMIT, answerQuestion, nextQuestion, skipQuestion } from "./clarify";
import { onboardingIntelligenceOn } from "./flag";
import { reinvestigateIfChanged } from "./investigation/incremental";
import { investigate } from "./investigation/loop";
import { investigatorFor, type ModelUsage } from "./investigation/models";
import { bindKnowledgeTenant, questions, type KnowledgeScope } from "./store";
import { readBusinessUnderstanding } from "./understanding";

/**
 * Where business knowledge meets the first ten minutes, the portrait and Claire. Every entry point here is inert
 * unless JOYSTICK_ONBOARDING_INTELLIGENCE=on (flag.ts), and only for a person's own journey (never Nina's example).
 */

export const scopeOf = (journey: Pick<JourneyRow, "id" | "tenantId">): KnowledgeScope => ({ journeyId: journey.id, tenantId: journey.tenantId ?? null });

export const intelligenceFor = (journey: Pick<JourneyRow, "kind">, env: NodeJS.ProcessEnv = process.env) => journey.kind === "own" && onboardingIntelligenceOn(env);

/** Words that name work that is paused or past: what the portrait and the chapter must not present as current. */
export function quietTerms(understanding: BusinessUnderstanding): string[] {
  const STOP = new Set(["the", "and", "for", "with", "work", "proposal", "proposals", "project", "projects", "business"]);
  const words = [...understanding.dormant, ...understanding.historical].flatMap(entity =>
    entity.name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(word => word.length >= 4 && !STOP.has(word))
      .map(word => word.replace(/s$/, ""))
  );
  return [...new Set(words)];
}

/**
 * Investigate the person's working life during their reading: called by the reading after its work stage, with a
 * heartbeat that keeps the reading's lease while the investigation runs. Returns what has gone quiet.
 */
export async function investigateJourney(
  journey: JourneyRow,
  access: GoogleAccess,
  heartbeat: () => Promise<void>,
  deps: { fetch?: typeof fetch; now?: () => Date; env?: NodeJS.ProcessEnv; served?: Set<string> } = {}
): Promise<{ quietTerms: string[]; notes: string[] }> {
  const scope = scopeOf(journey);
  const now = deps.now ?? (() => new Date());
  const ledger = new CoverageLedger(now);
  const usage: ModelUsage = { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  const notes: string[] = [];
  const { model } = investigatorFor(journey.id, usage, notes, { env: deps.env, served: deps.served });
  const research = googleResearch(access, ledger, { fetch: deps.fetch, now });
  const result = await investigate(scope, {
    research,
    ledger,
    model,
    ownerEmail: access.ownerEmail,
    now,
    trigger: "onboarding reading",
    notes,
    usage: usage as unknown as Record<string, number>,
    onProgress: heartbeat,
  });
  if (result.status === "failed") throw new Error("The investigation failed");
  return { quietTerms: quietTerms(await readBusinessUnderstanding(scope)), notes };
}

// ------------------------------------------------------------------ the chapter's opportunity

/** Whether an opportunity rests on a request about paused or past work, by the request's own words. */
export function quietOpportunity(opportunity: FindingView, findings: readonly FindingView[], terms: readonly string[]): boolean {
  if (opportunity.payload.kind !== "opportunity" || !terms.length) return false;
  const requestId = opportunity.payload.requestId;
  const request = findings.find(finding => finding.id === requestId);
  const text = JSON.stringify([request?.payload ?? null, opportunity.payload]).toLowerCase();
  return terms.some(term => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text));
}

/**
 * The findings the chapter may choose its opportunity from: with the feature on and no draft yet, opportunities
 * about work that is paused or past, as understood *now* (the person's answers included), are set aside, so the
 * chapter never leads to work they no longer do. If they said it is still current, it is offered again. Once a
 * draft exists, nothing changes under it.
 */
export async function chapterFindings(journey: JourneyRow, findings: FindingView[], drafted: boolean): Promise<FindingView[]> {
  if (drafted || !intelligenceFor(journey)) return findings;
  try {
    const terms = quietTerms(await readBusinessUnderstanding(scopeOf(journey)));
    return terms.length ? findings.filter(finding => !quietOpportunity(finding, findings, terms)) : findings;
  } catch {
    return findings;
  }
}

// ------------------------------------------------------------------ Claire's questions, before the portrait

export type OnboardingQuestionState = {
  enabled: boolean;
  /** the question to show now, one at a time */
  question: KnowledgeQuestionView | null;
  /** nothing left to ask before the portrait */
  settled: boolean;
  /** what Claire understood from the last answer, to say back */
  lastExplanation: string | null;
};

const OFF: OnboardingQuestionState = { enabled: false, question: null, settled: true, lastExplanation: null };

export async function onboardingQuestionState(journey: JourneyRow): Promise<OnboardingQuestionState> {
  if (!intelligenceFor(journey)) return OFF;
  const scope = scopeOf(journey);
  const question = await nextQuestion(scope, { limit: ONBOARDING_QUESTION_LIMIT });
  const resolved = (await questions(scope)).filter(row => row.status === "resolved" && row.answeredAt).sort((a, b) => b.answeredAt!.getTime() - a.answeredAt!.getTime());
  return { enabled: true, question, settled: !question, lastExplanation: resolved[0]?.resolutionJson?.explanation ?? null };
}

/** The person's answer to the question on screen, or `null` to leave it. Then the next one, if any. */
export async function answerOnboardingQuestion(journey: JourneyRow, questionId: string, answer: string | null): Promise<OnboardingQuestionState & { explanation: string | null }> {
  if (!intelligenceFor(journey)) return { ...OFF, explanation: null };
  const scope = scopeOf(journey);
  let explanation: string | null = null;
  if (answer === null) await skipQuestion(scope, questionId);
  else {
    const outcome = await answerQuestion(scope, questionId, answer);
    explanation = outcome.status === "resolved" ? outcome.question.explanation : null;
  }
  return { ...(await onboardingQuestionState(journey)), explanation };
}

// ------------------------------------------------------------------ the portrait, from the reconciled understanding

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthYear = (iso: string | null) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : null);

function entityFact(entity: UnderstoodEntity, bucket: "current" | "prelaunch" | "dormant" | "historical"): string {
  const theirs = entity.statusBasis === "user_confirmed" || entity.statusBasis === "user_corrected";
  const kind = entity.kind === "product" ? "a product" : entity.kind === "project" ? "work" : entity.kind === "brand" ? "a name they trade under" : "a business";
  switch (bucket) {
    case "current":
      return `${entity.name} is ${kind} that is current${theirs ? " (they said so)" : day(entity.lastActivityAt) ? `, most recently active in ${monthYear(entity.lastActivityAt)}` : ""}`;
    case "prelaunch":
      return `${entity.name} is ${kind} being built and prepared for launch; no launch date, sales or customers are known`;
    case "dormant":
      return `${entity.name} is past or paused work: active until ${monthYear(entity.lastActivityAt) ?? "earlier"}, quiet since`;
    case "historical":
      return `${entity.name} is past work${theirs ? " (they said so)" : ""}`;
  }
}

const RELATION_WORDS: Record<string, string> = {
  brand_of: "is a name used by",
  related_operation: "is related to, but not the same company as,",
  separate_business: "is a separate business from",
  same_legal_entity: "is the same company as",
  product_of: "is a product of",
  part_of: "is part of",
  works_at: "works with",
};

/** The understanding as citeable portrait facts. Null when the feature is off or nothing was understood. */
export function portraitKnowledgeOf(understanding: BusinessUnderstanding): PortraitKnowledge | null {
  const facts: PortraitKnowledge["facts"] = [];
  for (const [bucket, list] of [["current", understanding.current], ["prelaunch", understanding.prelaunch], ["dormant", understanding.dormant], ["historical", understanding.historical]] as const) {
    for (const entity of list) facts.push({ id: `k:${entity.id}`, fact: entityFact(entity, bucket), names: [entity.name], historical: bucket === "dormant" || bucket === "historical" });
  }
  for (const person of understanding.people) {
    facts.push({ id: `k:${person.id}`, fact: `${person.name} works with them${person.role ? `: ${person.role}` : ""}`, names: [person.name], historical: false });
  }
  for (const relationship of understanding.relationships) {
    const words = RELATION_WORDS[relationship.type];
    if (!words) continue;
    const theirs = relationship.basis === "user_confirmed" || relationship.basis === "user_corrected";
    facts.push({
      id: `k:${relationship.id}`,
      fact: `${relationship.subject} ${words} ${relationship.object}${theirs && relationship.detail ? `; in their words: "${relationship.detail}"` : ""}`,
      names: [relationship.subject, relationship.object],
      historical: false,
    });
  }
  return facts.length ? { facts: facts.slice(0, 24), quietTerms: quietTerms(understanding) } : null;
}

/**
 * What the portrait may write from: the reconciled understanding, once Claire's questions are answered or left.
 * `questions_pending` while one is still waiting; null when the feature is off or nothing was understood.
 */
export async function onboardingPortraitKnowledge(journey: JourneyRow): Promise<PortraitKnowledge | null | "questions_pending"> {
  if (!intelligenceFor(journey)) return null;
  const state = await onboardingQuestionState(journey);
  if (!state.settled) return "questions_pending";
  return portraitKnowledgeOf(await readBusinessUnderstanding(scopeOf(journey)));
}

// ------------------------------------------------------------------ Claire, after onboarding

const REFRESHING = new Map<string, number>();

/**
 * The tenant's reconciled understanding, for Claire: the journey that became this workspace, its knowledge stamped
 * with the tenant (so only this tenant can read it). Null when the feature is off or there is none. Never waits on
 * Google: when the understanding may be stale, a small incremental update starts in the background (at most every
 * twelve hours per journey; see investigation/incremental.ts) and this conversation uses what is already known.
 */
export async function readTenantBusinessUnderstanding(
  tenantId: string,
  deps: {
    env?: NodeJS.ProcessEnv;
    journeyForTenant?: (tenantId: string) => Promise<JourneyRow | null>;
    accessFor?: (journey: JourneyRow) => Promise<GoogleAccess | null>;
  } = {}
): Promise<BusinessUnderstanding | null> {
  const env = deps.env ?? process.env;
  if (!tenantId.trim() || !onboardingIntelligenceOn(env)) return null;
  const journeyFor = deps.journeyForTenant ?? (await import("../firstTenMinutes/knowledge/tenantKnowledge")).journeyForTenant;
  const journey = await journeyFor(tenantId);
  if (!journey || journey.tenantId !== tenantId) return null;
  await bindKnowledgeTenant(journey.id, tenantId);
  const scope = { journeyId: journey.id, tenantId };
  const understanding = await readBusinessUnderstanding(scope);
  refreshInBackground(journey, scope, deps.accessFor);
  return understanding.understoodAt ? understanding : null;
}

function refreshInBackground(journey: JourneyRow, scope: KnowledgeScope, accessFor?: (journey: JourneyRow) => Promise<GoogleAccess | null>) {
  const last = REFRESHING.get(journey.id) ?? 0;
  if (Date.now() - last < 60 * 60_000) return;
  REFRESHING.set(journey.id, Date.now());
  void (async () => {
    try {
      const access = await (accessFor ?? (await import("../firstTenMinutes/understanding/deps")).googleAccessFor)(journey);
      if (!access) return;
      const ledger = new CoverageLedger();
      const usage: ModelUsage = { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
      const { model } = investigatorFor(journey.id, usage, []);
      await reinvestigateIfChanged(scope, { research: googleResearch(access, ledger), ledger, model, ownerEmail: access.ownerEmail, now: () => new Date() });
    } catch (error) {
      console.warn("[BusinessKnowledge] the background update failed:", error instanceof Error ? error.name : "unknown");
    }
  })();
}
