import { CLAIRE_CANON } from "./character/characterDefinition";

const TOPIC_HINTS: Array<{ topic: string; pattern: RegExp }> = [
  { topic: "father", pattern: /\b(father|dad|your old man)\b/i },
  { topic: "past_relationship", pattern: /\b(married|marriage|husband|wife|boyfriend|girlfriend|ex\b|romantic|relationship)\b/i },
  { topic: "age", pattern: /\b(how old|your age|age are you)\b/i },
  { topic: "is_she_real", pattern: /\b(are you (?:real|human|an? ai|constructed)|are you actually)\b/i },
  { topic: "childhood", pattern: /\b(childhood|grow up|grew up|where (?:are|were) you from)\b/i },
  { topic: "central_wound", pattern: /\b(what (?:are you|were you) afraid of|why (?:do|don't) you trust)\b/i },
  { topic: "professional_failure", pattern: /\b(your (?:failure|mistake)|what went wrong (?:in|on) (?:the )?field)\b/i },
  { topic: "background", pattern: /\b(your background|what did you study|where did you train)\b/i },
];

export function detectRequestedClaireTopic(utterance: string): string | undefined {
  const hit = TOPIC_HINTS.find(entry => entry.pattern.test(utterance));
  if (!hit) return undefined;
  return CLAIRE_CANON.some(fragment => fragment.topic === hit.topic) ? hit.topic : undefined;
}

export function detectClaireConversationalMode(
  utterance: string
): "operational" | "casual" | "personal" | "post_action_review" {
  if (detectRequestedClaireTopic(utterance)) return "personal";
  if (/\b(how (?:did|does) that go|what happened with|after you (?:finish|done))\b/i.test(utterance)) {
    return "post_action_review";
  }
  if (/\b(how are you|what's new|good morning|good evening)\b/i.test(utterance)) return "casual";
  return "operational";
}
