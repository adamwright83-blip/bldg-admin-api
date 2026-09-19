import type { invokeTextLLM } from "../../_core/llm";
import { claireModelRequest } from "../claireModel";
import { findUnauthorizedFirstPersonBiography } from "./personalEntailment";

/**
 * The general-answer biography boundary. Invariant:
 *
 *   Outside the guarded personal controller, the generative model may never establish new Claire
 *   biography. Authorized canon facts are the only Claire history that exists.
 *
 * Architecture (no biography vocabulary is enumerated here):
 *  1. STRUCTURAL candidate detection — closed-class grammar only: a sentence is a candidate when it
 *     speaks in Claire's first person (I / I'm / I've / my / mine / myself), unless it is a
 *     forward-looking modal statement ("I'd start with the pilot") or an opinion frame ("My take is…")
 *     that carries no past/aspect marker. No candidate => no model call, no added latency.
 *  2. SEMANTIC verification of ONLY the candidate sentences by a bounded verifier that is given the
 *     authorized facts and must answer exactly CLEAN. Uncertainty, error, timeout, or anything else is a
 *     rejection.
 *  3. Rejection never regenerates. The caller substitutes an existing safe fallback / approved decline.
 *
 * The older precise first-person patterns remain only as a zero-latency fast reject for obvious cases;
 * the invariant does not depend on them.
 */

const FIRST_PERSON = /\bI(?:'m|'ve|'d|'ll)?\b|\b(?:my|mine|myself)\b/gi;
const PLURAL_FIRST_PERSON = /\b(?:we|our|ours|us|ourselves)\b/i;
/** Forward-looking / modal statements: "I'd start…", "I can draft…", "I'll follow up…". */
const MODAL_LED = /\bI(?:'d|'ll)\b|\bI (?:would|will|can|could|should|might|may|must|shall)\b/;
/** Opinion/plan frames: "My recommendation is…", "My take: …". */
const STANCE_FRAME = /^\W*(?:my|the) (?:recommendation|read|take|view|advice|suggestion|guess|question|answer|point|concern|plan|call)\b/i;
/** Past / aspect / time function words. Their presence means a modal or stance frame is NOT enough to skip. */
const HISTORY_ASPECT = /\b(?:was|were|had|did|used to|ago|once|when|before|ever|never|always|back|since|while|years?|months?|weeks?|summers?|winters?)\b/i;

/** Sentences that could plausibly assert Claire-self/history. Purely structural. */
export function extractSelfClaimCandidates(text: string): string[] {
  const out: string[] = [];
  // Models often emit typographic apostrophes; normalize so "I’d" is recognized like "I'd".
  for (const raw of text.replace(/[\u2018\u2019]/g, "'").split(/(?<=[.!?])\s+|\n+/)) {
    const sentence = raw.trim();
    if (!sentence) continue;
    FIRST_PERSON.lastIndex = 0;
    // "I" must be the capital pronoun; "my/mine/myself" match in any case.
    const matches = [...sentence.matchAll(FIRST_PERSON)].filter(m => !/^i/i.test(m[0]) || m[0][0] === "I");
    // First-person plural with a past/aspect marker can also narrate Claire's past ("Growing up, we never…").
    const pluralHistory = HISTORY_ASPECT.test(sentence) && PLURAL_FIRST_PERSON.test(sentence);
    if (!matches.length && !pluralHistory) continue;
    const aspect = HISTORY_ASPECT.test(sentence);
    if (!aspect && (MODAL_LED.test(sentence) || STANCE_FRAME.test(sentence))) continue;
    out.push(sentence);
  }
  return out;
}

export type BiographyVerifier = (input: { allowedFacts: readonly string[]; sentences: readonly string[] }) => Promise<boolean>;

export const BIOGRAPHY_VERIFIER_INSTRUCTION =
  "You check Claire's spoken lines for invented personal history. AUTHORIZED FACTS are the only biography Claire has. Reply CLEAN only if NONE of the SENTENCES asserts anything about Claire's own life, past, experiences, relationships, possessions, habits, feelings or attributes beyond the authorized facts. Business actions, recommendations, opinions, and statements about the supplied business data are NOT biography. Reply BIOGRAPHY if any sentence does, or if you are unsure. One word.";

export function parseBiographyVerdict(reply: string): boolean {
  return reply.trim().toUpperCase().replace(/[^A-Z]/g, "") === "CLEAN";
}

/** Verifier backed by the Claire model. Temperature 0, one word, tiny token budget. */
export function makeBiographyVerifier(invokeText: typeof invokeTextLLM, tenantId: string): BiographyVerifier {
  return async ({ allowedFacts, sentences }) => {
    const reply = await invokeText({
      tenantId,
      ...claireModelRequest(0),
      maxTokens: 8,
      messages: [
        { role: "system", content: BIOGRAPHY_VERIFIER_INSTRUCTION },
        { role: "user", content: `AUTHORIZED FACTS: ${allowedFacts.join(" | ") || "(none)"}\nSENTENCES:\n${sentences.map(s => `- ${s}`).join("\n")}` },
      ],
    });
    return parseBiographyVerdict(reply);
  };
}

export const BIOGRAPHY_VERIFIER_TIMEOUT_MS = 2_500;

export type BiographyBoundaryResult =
  | { ok: true; candidates: string[]; verified: boolean }
  | { ok: false; reason: "pattern" | "biography" | "verifier_unavailable"; candidates: string[]; sentence?: string };

export async function checkBiographyBoundary(input: {
  text: string;
  allowedFacts: readonly string[];
  verify: BiographyVerifier;
  timeoutMs?: number;
}): Promise<BiographyBoundaryResult> {
  const candidates = extractSelfClaimCandidates(input.text);
  if (!candidates.length) return { ok: true, candidates, verified: false }; // no candidate: no model call
  const obvious = findUnauthorizedFirstPersonBiography(input.text, input.allowedFacts);
  if (obvious) return { ok: false, reason: "pattern", candidates, sentence: obvious };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const clean = await Promise.race([
      input.verify({ allowedFacts: input.allowedFacts, sentences: candidates }),
      new Promise<"timeout">(resolve => {
        timer = setTimeout(() => resolve("timeout"), input.timeoutMs ?? BIOGRAPHY_VERIFIER_TIMEOUT_MS);
      }),
    ]);
    if (clean === "timeout") return { ok: false, reason: "verifier_unavailable", candidates };
    return clean ? { ok: true, candidates, verified: true } : { ok: false, reason: "biography", candidates };
  } catch {
    return { ok: false, reason: "verifier_unavailable", candidates }; // error = reject
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class ClaireBiographyBoundaryError extends Error {
  constructor(readonly detail: BiographyBoundaryResult) {
    super("Generated Claire speech asserted unauthorized personal history");
    this.name = "ClaireBiographyBoundaryError";
  }
}

/** Throwing form for generation sites that already route errors to a deterministic fallback. */
export async function assertNoUnauthorizedClaireBiography(input: {
  text: string;
  allowedFacts: readonly string[];
  verify: BiographyVerifier;
  timeoutMs?: number;
}): Promise<void> {
  const result = await checkBiographyBoundary(input);
  if (!result.ok) throw new ClaireBiographyBoundaryError(result);
}
