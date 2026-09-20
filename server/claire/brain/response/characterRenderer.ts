/**
 * Claire's character renderer.
 *
 * It is fed ONLY by a `ResponsePlan`. It may phrase, order, join and compress.
 *
 * It may NOT add:
 *   - facts or numbers
 *   - authority or actions
 *   - disclosure permissions
 *   - call-control decisions
 *
 * The renderer phrases. It does not think. Every sentence it emits must trace to a
 * segment the executive already authored, which `assertRenderedFromPlan` verifies by
 * checking that no segment's content was dropped and no new digits appeared.
 *
 * There is no `planFromSpeak` here and there must never be one: prose is downstream of
 * the plan, and reverse-engineering a plan from a finished string is the exact failure
 * this architecture exists to remove.
 */

import type { ResponsePlan, ResponseSegment } from "../contracts/responsePlan";

export type RenderedResponse = {
  speak: string;
  endCall: boolean;
};

export type CharacterVoice = {
  /** Claire is measured and dry; she does not pad, apologise, or perform warmth. */
  surface: "voice" | "text";
};

/** Segment order is a presentation concern; authority is not. */
const SEGMENT_ORDER: Record<ResponseSegment["type"], number> = {
  BusinessFactSegment: 0,
  BusinessJudgmentSegment: 1,
  ActionConfirmationSegment: 2,
  ActionProposalSegment: 3,
  ConversationalSegment: 4,
  PersonalDisclosureSegment: 5,
  NarrativeRevealSegment: 6,
  CallControlSegment: 7,
};

function sentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Business first, leave-taking last. A call-control segment never suppresses the
 * content before it — "Dana hasn't replied, but I gotta go" keeps both.
 */
function ordered(segments: ResponseSegment[]): ResponseSegment[] {
  return segments
    .map((segment, index) => ({ segment, index }))
    .sort((a, b) => {
      const byType = SEGMENT_ORDER[a.segment.type] - SEGMENT_ORDER[b.segment.type];
      return byType !== 0 ? byType : a.index - b.index;
    })
    .map(entry => entry.segment);
}

export function renderWithCharacter(plan: ResponsePlan, _voice?: CharacterVoice): RenderedResponse {
  const parts: string[] = [];
  for (const segment of ordered(plan.segments)) {
    const text = sentence(segment.text);
    if (text) parts.push(text);
  }
  // Call control is a decision the executive already made; the renderer only reports it.
  const endCall = plan.segments.some(segment => segment.type === "CallControlSegment" && segment.endCall);
  return { speak: parts.join(" ").replace(/\s+/g, " ").trim(), endCall };
}

/** Digits the plan authorised. A rendered number outside this set was invented. */
function digitsIn(text: string): string[] {
  return text.match(/\d[\d,.]*/g)?.map(token => token.replace(/[.,]$/, "")) ?? [];
}

/**
 * Verify the renderer stayed inside its authority.
 *
 * Checks that every non-empty segment's content survived, and that the rendered text
 * introduced no number the plan did not already contain. This is a safety lint, not a
 * planner: it can only reject, never rewrite.
 */
export function assertRenderedFromPlan(plan: ResponsePlan, speak: string): void {
  const planDigits = new Set(plan.segments.flatMap(segment => digitsIn(segment.text)));
  for (const digit of digitsIn(speak)) {
    if (!planDigits.has(digit)) {
      throw new Error(`renderer introduced a number the ResponsePlan did not authorise: ${digit}`);
    }
  }
  for (const segment of plan.segments) {
    const core = segment.text.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
    if (!core) continue;
    if (!speak.includes(core)) {
      throw new Error(`renderer dropped authored ${segment.type} content`);
    }
  }
}
