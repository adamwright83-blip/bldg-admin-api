/**
 * Held topics in speech.
 *
 * A standing rule like "Don't bring up the magazine interview on calls" is
 * broken as surely by "I'm leaving the magazine interview out, per your rule"
 * as by raising it (runs 11 and 20). The prompt says so; the model still slips
 * about one time in three. This guard checks what Claire is about to say and,
 * when it names a held topic the operator has not raised, or announces that
 * something is being withheld, asks the model once to say it again without
 * that. Only if the second attempt still breaks the rule are the offending
 * sentences dropped, and that fallback is recorded as an event so it is never
 * invisible. Nothing is stripped blindly.
 *
 * The same check catches Claire narrating her own method aloud ("This is a
 * question, so I answer it and offer once.", eval run 40988869307; "This is
 * dictation, so I'll write all three now.", run 11): the prompt's own labels
 * read back to the operator.
 */
import type { StandingInstructionRecord } from "../../agents/daphne/standingInstructions";
import { distinctiveTokens, normalizeWords } from "./authorization";

const HOLD_RULE = /\b(?:don't|do not|never|stop|quit|no need to)\s+(?:bring(?:ing)? up|mention(?:ing)?|rais(?:e|ing)|talk(?:ing)? about|bug(?:ging)? me about|remind(?:ing)? me (?:about|of)|nag(?:ging)? me about)\s+(?:the |my |that |about )?([^.,;!?]+?)(?:\s+(?:on (?:these |our |the )?calls?|unless|until|anymore|again|when|ever|at all)\b|$)/i;
const ANNOUNCING_WITHHOLDING = /\b(standing rule|per your rule|your rule about|not supposed to (?:bring|mention|talk|raise)|leaving (?:it|that|this|them) out|i'll skip (?:it|that|this)|skipping (?:it|that|this)|won't (?:bring|mention|raise)|can't (?:bring|mention|talk about)|not allowed to (?:bring|mention|talk)|holding (?:that|it|this) back|i'm holding|withhold)\b/i;

/** A sentence that labels the operator's turn or announces how Claire will handle it. */
const NARRATES_METHOD = /^(?:(?:ok(?:ay)?|so|right|alright),?\s+)?(?:this|that)(?: one)? (?:is|was|sounds like|counts as) (?:a |an )?(?:question|dictation|musing|instruction|correction)\b|\b(?:so|then) i(?:'ll| will)? (?:answer it|write (?:it|them|all|both)|offer once|ask before)\b/i;

export type HeldTopic = { words: string[]; rule: string };

/** The topics the operator asked Claire not to raise, as identifying words. */
export function heldTopicsFrom(records: readonly Pick<StandingInstructionRecord, "kind" | "status" | "text" | "quote">[]): HeldTopic[] {
  const out: HeldTopic[] = [];
  for (const record of records) {
    if (record.status !== "active" || record.kind !== "call_rule") continue;
    const match = HOLD_RULE.exec(record.quote) ?? HOLD_RULE.exec(record.text);
    if (!match) continue;
    const words = distinctiveTokens(match[1]!).filter(word => !["anything", "everything", "stuff", "things", "that", "this"].includes(word));
    if (words.length) out.push({ words, rule: record.quote });
  }
  return out;
}

export type SpeechProblem =
  | { kind: "names_held_topic"; topic: HeldTopic; sentence: string }
  | { kind: "announces_withholding"; sentence: string }
  | { kind: "narrates_method"; sentence: string };

export function sentencesOfSpeech(text: string): string[] {
  return text.replace(/[’‘]/g, "'").split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(Boolean);
}

/**
 * What is wrong with `speech`, if anything: it names a held topic the operator
 * has not raised on this call, or it announces that something is withheld.
 */
export function checkSpeech(speech: string, input: { heldTopics: readonly HeldTopic[]; operatorTurns: readonly string[] }): SpeechProblem[] {
  const problems: SpeechProblem[] = [];
  const operatorText = normalizeWords(input.operatorTurns.join(" "));
  const operatorWords = new Set(operatorText.split(" "));
  for (const sentence of sentencesOfSpeech(speech)) {
    const words = new Set(normalizeWords(sentence).split(" ").map(word => word.replace(/'s$/, "")));
    for (const topic of input.heldTopics) {
      const raisedByOperator = topic.words.some(word => operatorWords.has(word));
      if (raisedByOperator) continue;
      if (topic.words.some(word => words.has(word))) problems.push({ kind: "names_held_topic", topic, sentence });
    }
    if (ANNOUNCING_WITHHOLDING.test(sentence)) problems.push({ kind: "announces_withholding", sentence });
    if (NARRATES_METHOD.test(sentence)) problems.push({ kind: "narrates_method", sentence });
  }
  return problems;
}

/** The note sent back to the model for one more attempt. */
export function restateInstruction(problems: readonly SpeechProblem[]): string {
  const named = problems.filter((p): p is Extract<SpeechProblem, { kind: "names_held_topic" }> => p.kind === "names_held_topic");
  const parts: string[] = [];
  if (named.length) parts.push(`Your reply named a topic the operator asked you not to raise (rule: "${named[0]!.topic.rule}"). Do not name it and do not refer to it.`);
  if (problems.some(p => p.kind === "announces_withholding")) parts.push("Your reply announced that you were leaving something out. Do not say that; just answer without it.");
  if (problems.some(p => p.kind === "narrates_method")) parts.push("Your reply described how you were handling their words (what kind of turn it was, or what you would do with it). They hear everything you write; just answer.");
  parts.push("Say your reply again, briefly, with those sentences gone. Do not call any tool; nothing else changed.");
  return parts.join(" ");
}

/** Last resort: the speech with the offending sentences removed. */
export function withoutOffendingSentences(speech: string, problems: readonly SpeechProblem[]): string {
  const bad = new Set(problems.map(problem => problem.sentence));
  return sentencesOfSpeech(speech).filter(sentence => !bad.has(sentence)).join(" ");
}
