import { parseBusinessTurn, type ClaireAnalyticsSession } from "./businessConversation";
import { normalizeUtterance } from "./business/businessLanguage";
import type { EncyclopediaAnswer } from "./knowledge/encyclopediaAgent";
import { accountAspect, isAccountQuestion, matchAccounts, type AccountRef } from "./knowledge/accountKnowledge";
import { resolveEntitiesToAccounts } from "./knowledge/contactAccountResolution";
import { operationsQuestion } from "./knowledge/operationsKnowledge";
import { isUnpaidQuestion } from "./knowledge/openOrdersKnowledge";
import type { ClaireAnswerPath } from "./answerPathTelemetry";
import { extractEntities, interpretTurn } from "./turn/interpretTurn";

/**
 * Claire Intelligence Repair Part 2, Slice C+D corrective pass.
 *
 * Routing authority lives here — not in JUDGMENT_CLAUSE / classifyClaireAnswerClass.
 * Those regex helpers remain in answerPathTelemetry.ts as a Slice A census only.
 *
 * A deterministic reader may be the final answer only when Goldline can
 * positively establish that retrieved evidence fully answers the entire
 * utterance. Retrieval success alone is never enough. When uncertain, synthesize.
 */

export const CLAIRE_ROUTE_OUTCOMES = [
  "deterministic_final",
  "retrieval_plus_synthesis",
  "judgment_synthesis_no_retrieval",
  "unsupported_fact",
  "briefing_plus_synthesis",
] as const;

export type ClaireRouteOutcome = (typeof CLAIRE_ROUTE_OUTCOMES)[number];

/**
 * Cross-call memory questions. A fact matcher (like isUnpaidQuestion), not a
 * judgment classifier — used to find evidence and, on a single-ask utterance,
 * to allow the memory reader to finish.
 */
export const MEMORY_QUESTION =
  /\bwhat did (?:i|we) (?:say|tell you|talk about|decide|agree)\b|\bwhat was i (?:worried|concerned|stressed|thinking) about\b|\bwhat did you tell me\b|\bdid i (?:mention|tell you)\b|\bwhat have i told you\b|\bremind me what (?:we|i|you) (?:decided|said|agreed|told)\b/;

const ASK_SHAPE =
  /^(?:how |what|what's|whats|who|when|which|where|why|should |would |could |is it |is that |can (?:i|we|you)\b|do (?:i|we|you)\b|did |does |remind me|tell me|give me)\b/i;

export type ClaireLocalMatch = {
  path: Extract<ClaireAnswerPath, "business_reader" | "day_work" | "unpaid_orders" | "account_history" | "memory_quote">;
  source: string;
  /**
   * True only for dedicated whole-utterance fact matchers. Account history may
   * terminate only via `accountHistoryMayFinish` — `isAccountQuestion` is too
   * broad (`visit`, `pitch`) to be a terminator on its own.
   */
  mayTerminate: boolean;
};

export type ClaireRouteEvidence = {
  source: string;
  text: string;
  /** Provenance only: the authoritative query result that produced `text`, so the turn can leave a claim receipt. */
  businessResult?: import("../analytics/businessQuery").BusinessQueryResult;
  reader?: string | null;
  /** The reader stated facts (vs asked a clarifying question / declined); only factual statements get receipts. */
  factual?: boolean;
};

export type ClaireRouteDecision = {
  outcome: ClaireRouteOutcome;
  path?: ClaireAnswerPath;
  evidence: ClaireRouteEvidence[];
  unsupportedText?: string;
  preserveJudgment?: boolean;
};

export function splitClaireRequestClauses(utterance: string): string[] {
  const trimmed = utterance.trim();
  if (!trimmed) return [];
  const sentences = trimmed
    .split(/(?<=[.?])\s+|(?<=;)\s+/)
    .map(part => part.trim())
    .filter(Boolean);
  const clauses: string[] = [];
  for (const sentence of sentences) {
    const parts = sentence.split(/\s*,\s+and\s+/i).map(part => part.trim()).filter(Boolean);
    clauses.push(...(parts.length ? parts : [sentence]));
  }
  return clauses.length ? clauses : [trimmed];
}

export function clauseLooksLikeAsk(clause: string): boolean {
  const bare = clause.trim();
  if (!bare) return false;
  return /\?$/.test(bare) || ASK_SHAPE.test(bare);
}

/**
 * Fail-closed remainder check: more than one request-shaped clause means a
 * reader that answers the first clause cannot finish the turn.
 * Structural, not the old judgment-phrase list.
 */
export function utteranceHasMultipleAsks(utterance: string): boolean {
  const clauses = splitClaireRequestClauses(utterance);
  if (clauses.length <= 1) return false;
  return clauses.filter(clauseLooksLikeAsk).length >= 1 && clauses.length >= 2;
}

export function accountHistoryMayFinish(utterance: string): boolean {
  if (utteranceHasMultipleAsks(utterance)) return false;
  const trimmed = utterance.trim();
  if (/^(?:should|would|could|why|how should|is it worth)\b/i.test(trimmed)) return false;
  if (/\b(?:should i|would i|could i|is it worth|how should i|what should i)\b/i.test(trimmed)) return false;
  const lower = normalizeUtterance(utterance);
  if (MEMORY_QUESTION.test(lower)) return true;
  const aspect = accountAspect(lower);
  return (
    aspect === "last_contact" ||
    aspect === "said" ||
    aspect === "follow_up" ||
    aspect === "visit" ||
    (aspect === "summary" && isAccountQuestion(lower)) ||
    /\b(what happened|last (?:contact|time|visit|touch)|what did i (?:say|tell)|what do (?:we|i) know|tell me about|owe)\b/i.test(lower)
  );
}

export function collectClaireLocalFactMatches(
  utterance: string,
  input: {
    accounts: AccountRef[];
    now: Date;
    timeZone: string;
    session?: ClaireAnalyticsSession | null;
  }
): ClaireLocalMatch[] {
  const lower = normalizeUtterance(utterance);
  const matches: ClaireLocalMatch[] = [];
  const operations = operationsQuestion(lower);
  const unpaid = isUnpaidQuestion(lower) && !/\bfollow[- ]?up\b/.test(lower);
  const memory = MEMORY_QUESTION.test(lower);
  // Dedicated whole-utterance matchers first. parseBusinessTurn is greedy
  // (it treats "unpaid orders" as analytics) and must not outrank them.
  if (operations) {
    matches.push({ path: "day_work", source: "day_work", mayTerminate: true });
  }
  if (unpaid) {
    matches.push({ path: "unpaid_orders", source: "unpaid_orders", mayTerminate: true });
  }
  const matched = matchAccounts(lower, input.accounts);
  const accountCanFinish = matched.length === 1 && accountHistoryMayFinish(utterance);
  // Named-account "what did I tell you about X" is account-history said-aspect,
  // not the generic call-memory renderer.
  if (memory && !accountCanFinish) {
    matches.push({ path: "memory_quote", source: "call_memory", mayTerminate: true });
  }
  if (!operations && !unpaid && !memory) {
    try {
      const parsed = parseBusinessTurn(utterance, input.session ?? null, input.now, input.timeZone, {
        interpretation: interpretTurn(utterance),
      });
      if (parsed.kind !== "not_analytics") {
        matches.push({
          path: "business_reader",
          source: `business_reader:${parsed.kind}`,
          mayTerminate: true,
        });
      }
    } catch {
      // Same degrade as live: no match from this source.
    }
  }
  if (matched.length === 1 && (isAccountQuestion(lower) || memory)) {
    matches.push({
      path: "account_history",
      source: "account_history",
      mayTerminate: accountCanFinish,
    });
  }
  const scopedContactJudgment =
    !operations &&
    !unpaid &&
    /\b(?:what should i|how should i|what about)\b/i.test(lower) &&
    resolveEntitiesToAccounts(extractEntities(utterance).entities, input.accounts).some(item => item.kind === "contact");
  if (scopedContactJudgment) {
    matches.push({
      path: "account_history",
      source: "contact_account_judgment",
      mayTerminate: true,
    });
  }
  return matches;
}

function encyclopediaEvidence(encyclopedia: EncyclopediaAnswer | null): ClaireRouteEvidence[] {
  if (!encyclopedia) return [];
  if (encyclopedia.kind === "answered" || encyclopedia.kind === "unsupported_fact") {
    return encyclopedia.evidence.length
      ? encyclopedia.evidence
      : [{ source: encyclopedia.kind, text: encyclopedia.text }];
  }
  return [];
}

/**
 * The routing decision. Callers load evidence separately; this function only
 * decides whether a renderer may speak, or Claire must synthesize.
 */
export function decideClaireAnswerRoute(input: {
  utterance: string;
  encyclopedia: EncyclopediaAnswer | null;
  localMatches: ClaireLocalMatch[];
  loadedEvidence?: ClaireRouteEvidence[];
  briefingWorkItems: number;
  briefingQuestions: number;
  multipleAsks?: boolean;
}): ClaireRouteDecision {
  const multipleAsks = input.multipleAsks ?? utteranceHasMultipleAsks(input.utterance);
  const loaded = input.loadedEvidence ?? [];
  const localEvidence = loaded.length
    ? loaded
    : input.localMatches.map(match => ({ source: match.source, text: "" }));
  const encEvidence = encyclopediaEvidence(input.encyclopedia);
  const evidence = mergeEvidence(encEvidence, localEvidence);

  const briefingMixed =
    input.briefingWorkItems > 0 && (input.briefingQuestions > 0 || multipleAsks);
  if (briefingMixed) {
    return { outcome: "briefing_plus_synthesis", evidence };
  }

  const enc = input.encyclopedia;

  if (enc?.kind === "answered" && enc.fullyAnswers === true && !multipleAsks && input.briefingWorkItems === 0) {
    return { outcome: "deterministic_final", path: "encyclopedia", evidence };
  }

  if (enc?.kind === "answered") {
    return { outcome: "retrieval_plus_synthesis", evidence };
  }

  if (enc?.kind === "unsupported_fact") {
    if (multipleAsks || input.briefingQuestions > 0) {
      return {
        outcome: "retrieval_plus_synthesis",
        evidence,
        unsupportedText: enc.text,
        preserveJudgment: true,
      };
    }
    return { outcome: "unsupported_fact", evidence, unsupportedText: enc.text };
  }

  if (enc?.kind === "no_retrieval_needed") {
    return { outcome: "judgment_synthesis_no_retrieval", evidence: [] };
  }

  const loadedFact = (input.loadedEvidence ?? []).filter(item => {
    if (!item.text.length) return false;
    if (
      item.source.startsWith("business_reader") ||
      item.source === "day_work" ||
      item.source === "unpaid_orders" ||
      item.source === "call_memory" ||
      item.source === "memory_quote" ||
      item.source === "contact_account_judgment"
    ) {
      return true;
    }
    return item.source === "account_history" && accountHistoryMayFinish(input.utterance);
  });
  const terminable = input.localMatches.filter(match => match.mayTerminate);
  const canFinishFromMatches = !input.loadedEvidence && terminable.length >= 1;
  if (!multipleAsks && input.briefingWorkItems === 0 && (loadedFact.length >= 1 || canFinishFromMatches)) {
    const source =
      loadedFact.find(item => item.source === "account_history")?.source ??
      loadedFact[0]?.source ??
      terminable[0]!.source;
    const path: ClaireRouteDecision["path"] = source.startsWith("business_reader")
      ? "business_reader"
      : source === "call_memory" || source === "memory_quote"
        ? "memory_quote"
        : source === "day_work"
          ? "day_work"
          : source === "unpaid_orders"
            ? "unpaid_orders"
            : source === "account_history" || source === "contact_account_judgment"
              ? "account_history"
              : "business_reader";
    return { outcome: "deterministic_final", path, evidence: localEvidence };
  }

  if (input.localMatches.length > 0 || loaded.length > 0) {
    return { outcome: "retrieval_plus_synthesis", evidence };
  }

  return { outcome: "judgment_synthesis_no_retrieval", evidence: [] };
}

function mergeEvidence(primary: ClaireRouteEvidence[], secondary: ClaireRouteEvidence[]): ClaireRouteEvidence[] {
  const seen = new Set<string>();
  const out: ClaireRouteEvidence[] = [];
  for (const item of [...primary, ...secondary]) {
    const key = `${item.source}::${item.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
