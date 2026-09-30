/**
 * Explicit Day Line authority for the current turn.
 *
 * The model does not mint this. "Add that to the day line" commits the work
 * the operator already described. An explicit "as a challenge" / "is a
 * challenge" is the only execution type. Unfinished clauses are not items.
 */

import { explicitOperatorExecutionType, type ObjectiveExecutionType } from "../../../shared/objectiveExecution";
import { executionTypeLabel } from "../../../shared/currentDayLine";
import { compressTitle } from "./titleContract";
import type { BriefingClock, BriefingItem } from "./briefingTypes";

const ACTION =
  /\b(?:drive|driving|process|processing|do|doing|make|making|create|creating|post|posting|design|designing|call|calling|email|e-mail|text|message|send|follow\s*up|chase|schedule|book|check|quote|estimate|invoice|order|buy|research|review|finish|repair|install|pick|drop|deliver|visit|wash|fold)\b/i;

const DIRECTIVE =
  /\b(?:add|put|place|log|save|track)\b|\b(?:make sure|be sure)\b/i;

export function refersToPriorWork(utterance: string): boolean {
  return /\b(?:all that|all of that|everything(?: i (?:said|told you))?|what i told you|what i said|(?:all\s+)?(?:that|the)\s+stuff|the stuff|those things|the things i (?:said|mentioned|told you)|everything we just talked about|batch (?:them|those|all)|(?:the\s+)?dormant (?:accounts|customers)|recovery texts|put them|them all|the whole group|whole group|those people|that group|that work|everyone|everybody)\b/i.test(
    utterance
  );
}

function clausesOf(text: string): string[] {
  return text
    .split(/\b(?=(?:just\s+)?(?:add|put)\b)/i)
    .flatMap(part =>
      part.split(/(?<=[.!?])\s+|\s*,\s*(?=(?:and|but)\s+(?:are|do|did|is|was|when|what|where|who|why|how)\b)/i)
    )
    .map(part => part.trim())
    .filter(Boolean);
}

function isDirectiveOnly(text: string): boolean {
  const stripped = text
    .replace(/\b(?:just\s+)?add (?:all that|all of that|everything|what i told you|what i said|(?:all\s+)?(?:that|the)\s+stuff|the stuff|those things|the things i (?:said|mentioned|told you)|everything we just talked about)\b[^.]{0,48}\b(?:to|on|onto)\s+(?:the\s+|my\s+)?day\s*line\b/gi, " ")
    .replace(/\b(?:put|add|place|log|save|track)\b/gi, " ")
    .replace(/\b(?:on|onto|to)\s+(?:the\s+|my\s+)?day\s*line\b/gi, " ")
    .replace(/\b(?:what i told you|what i said|all that|all of that|(?:all\s+)?(?:that|the)\s+stuff|the stuff|those things|the things i (?:said|mentioned|told you)|everything we just talked about)\b/gi, " ")
    .replace(/\b(?:i want you to\s+)+/gi, " ")
    .replace(/\b(?:make sure|be sure)(?: that)?(?: you)?\b/gi, " ")
    .replace(/\b(?:as|is)\s+a\s+(?:challenge|mission)\b/gi, " ")
    .replace(/[^a-z0-9 ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.split(/\s+/).filter(token => token.length > 2).length < 2;
}

function workQuote(clause: string, unfinished: (text: string) => boolean): string | null {
  if (/\?\s*$/.test(clause)) return null;
  if (isDirectiveOnly(clause)) return null;
  const directed = DIRECTIVE.test(clause);
  if (unfinished(clause) && !directed) return null;
  if (!ACTION.test(clause) && !directed) return null;
  const quote = clause
    .replace(/\b(?:i want you to\s+)+/gi, " ")
    .replace(/\b(?:make sure|be sure)(?: that)?(?: you)?\b/gi, " ")
    .replace(/\b(?:just\s+)?(?:add|put|place|log|save|track)\b/gi, " ")
    .replace(/\b(?:on|onto|to)\s+(?:the\s+|my\s+)?day\s*line\b/gi, " ")
    .replace(/\b(?:what i told you|what i said|all that|all of that|everything(?: i (?:said|told you))?|(?:all\s+)?(?:that|the)\s+stuff|the stuff|those things|the things i (?:said|mentioned|told you)|everything we just talked about)\b/gi, " ")
    .replace(/\b(?:as|is)\s+a\s+(?:challenge|mission)\b/gi, " ")
    .replace(/^(?:(?:that|and|you|to|just)\s+)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (quote.split(/\s+/).filter(Boolean).length < 3) return null;
  if (unfinished(quote)) return null;
  if (isDirectiveOnly(quote)) return null;
  return quote;
}

function tokens(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter(token => token.length >= 4 && !["that", "this", "with", "from", "have", "need", "just", "line", "your", "what", "told"].includes(token))
    )
  );
}

function sameWork(a: string, b: string): boolean {
  const left = tokens(a);
  const right = tokens(b);
  const shared = left.filter(token => right.includes(token));
  return shared.length >= 2 || (left.length === 1 && right.length === 1 && shared.length === 1);
}

function typeFor(quote: string, corpus: string): ObjectiveExecutionType | null {
  const local = explicitOperatorExecutionType(quote);
  if (local) return local;
  const sentences = corpus.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const named = explicitOperatorExecutionType(sentence);
    if (!named) continue;
    if (sameWork(quote, sentence) || tokens(quote).filter(token => sentence.toLowerCase().includes(token)).length >= 2) {
      return named;
    }
  }
  return null;
}

export function assembleReferencedDayLineWork(input: {
  utterance: string;
  priorOperatorUtterances: string[];
  clock: BriefingClock;
  unfinished: (text: string) => boolean;
  history?: Array<{ speaker: string; text: string }>;
  surfacedAccounts?: Array<{ id: string; name: string }>;
}): BriefingItem[] {
  // Recovery anaphora is resolved only from structured entities Claire
  // actually surfaced. Conversation prose is not an identity database.
  const explicitRecovery =
    /\b(?:dormant\s+(?:accounts|customers)|recovery\s+(?:texts|messages|outreach)|win[- ]?back)\b/i.test(
      input.utterance
    );
  const anaphoricGroup =
    /\b(?:batch|do|send|put|add)\b[^.!?]{0,40}\b(?:them|those|the whole group|whole group|everyone|everybody|those people|that group|that work)\b/i.test(
      input.utterance
    ) ||
    /\b(?:those people|the people|that group|the whole group|everyone|everybody)\b[^.!?]{0,40}\b(?:mentioned|named|just mentioned)\b/i.test(
      input.utterance
    );
  const structuredRefs = input.surfacedAccounts ?? [];

  if ((explicitRecovery || anaphoricGroup) && (structuredRefs.length > 0 || explicitRecovery)) {
    if (anaphoricGroup && structuredRefs.length === 0) {
      // "Them" has no durable referent. Never invent a customer set from a
      // number or a sentence in history.
      return [];
    }
    const count = structuredRefs.length;
    const title = count
      ? `Send ${count} dormant-customer recovery texts`
      : "Send dormant-customer recovery texts";
    const names = structuredRefs.map(ref => ref.name);
    const quote = count
      ? `Send recovery texts today to ${names.join(", ")}`
      : "Send dormant-customer recovery texts today";
    return [
      {
        kind: "new_work",
        title,
        quote,
        businessDate: input.clock.today,
        timing: { kind: "none" },
        quantity: count || null,
        people: names,
        place: null,
        needs: null,
        existing: null,
        references: structuredRefs.map(ref => ({
          kind: "customer" as const,
          id: ref.id,
          name: ref.name,
          source: "conversation_referent" as const,
        })),
        executionType: "challenge",
      },
    ];
  }

  const corpus = [...input.priorOperatorUtterances, input.utterance].join(" ");
  const sources = refersToPriorWork(input.utterance) ? [...input.priorOperatorUtterances, input.utterance] : [input.utterance];
  const found: Array<{ quote: string; title: string }> = [];
  for (const source of sources) {
    if (input.unfinished(source) && !DIRECTIVE.test(source)) continue;
    for (const clause of clausesOf(source)) {
      const quote = workQuote(clause, input.unfinished);
      if (!quote) continue;
      const title = compressTitle(quote);
      if (!title || title.split(/\s+/).length < 2) continue;
      const previous = found.find(item => sameWork(item.quote, quote) || sameWork(item.title, title));
      if (previous) {
        if (quote.length > previous.quote.length) {
          previous.quote = quote;
          previous.title = title;
        }
        continue;
      }
      found.push({ quote, title });
    }
  }

  return found.map(item => ({
    kind: "new_work" as const,
    title: item.title,
    quote: item.quote,
    businessDate: input.clock.today,
    timing: { kind: "none" as const },
    quantity: null,
    people: [],
    place: null,
    needs: null,
    existing: null,
    executionType: typeFor(item.quote, corpus),
  }));
}

export function confirmExistingDayLineSpeech(items: BriefingItem[]): string {
  return items
    .map(item => {
      const title = item.existing?.title || item.title;
      const type = item.existing?.executionType ?? item.executionType ?? null;
      const label = executionTypeLabel(type);
      return type ? `${title} is on the line as ${label}.` : `${title} is on the line.`;
    })
    .join(" ");
}
