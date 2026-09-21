/**
 * Character renderer. Presentation, not cognition.
 * Concatenates ResponsePlan segment text. Adds no facts, numbers, grants, or call control.
 */

import type { ResponsePlan } from "../contracts/responsePlan";

export type RenderedResponse = {
  speak: string;
  endCall: boolean;
};

export function renderResponsePlan(plan: ResponsePlan): RenderedResponse {
  const parts = plan.segments.map(segment => segment.text).filter(text => text.trim().length > 0);
  const endCall = plan.segments.some(segment => segment.type === "CallControlSegment" && segment.endCall);
  return { speak: parts.join(" ").replace(/\s+/g, " ").trim(), endCall };
}

export function assertRendererDidNotInventFacts(plan: ResponsePlan, speak: string): void {
  const expected = renderResponsePlan(plan).speak;
  if (speak !== expected) {
    throw new Error("renderer added or removed content that was not in the ResponsePlan");
  }
}
