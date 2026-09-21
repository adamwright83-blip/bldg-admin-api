/**
 * Deterministic Day Director kind from the operator's words.
 *
 * An LLM may not invent category semantics the utterance does not support.
 * Unsupported text stays operations.
 */

import type { DayDirectorKind } from "../../shared/claireWorkdayCommand";

const GROWTH =
  /\b(zeely|instagram|ad(?:vert(?:isement)?)?|campaign|colosseum|coliseum|gr[ae]ystar|follow[- ]?up|pitch|pipeline|sales|collaborator|approval|russell|the louise|dana|commercial account|customer acquisition)\b/i;

const PREP =
  /\b(collateral|outfit|jacket|dress shirt|jeans|clothes|uniform|print(?:ing)?|prep(?:are)?|readiness)\b/i;

const TOMORROW_READY = /\b(tomorrow|tonight|for tomorrow|ready for)\b/i;

const HOUSEKEEPING = /\b(bathroom|housekeeping|clean (?:the |my )?(?:house|apartment|bathroom|kitchen)|personal chore)\b/i;

export function classifyDayDirectorKind(text: string): DayDirectorKind {
  const value = text.trim();
  if (!value) return "operations";
  if (PREP.test(value) && (TOMORROW_READY.test(value) || /\bprint|collateral|outfit|jacket|jeans|dress shirt\b/i.test(value))) {
    return "prep";
  }
  if (GROWTH.test(value) && !HOUSEKEEPING.test(value)) return "growth";
  return "operations";
}

export function isHousekeepingUtterance(text: string): boolean {
  return HOUSEKEEPING.test(text);
}

export function isTomorrowPrepUtterance(text: string): boolean {
  return classifyDayDirectorKind(text) === "prep" || (TOMORROW_READY.test(text) && PREP.test(text));
}
