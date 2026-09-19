import { CLAIRE_CANON } from "./character/characterDefinition";

const TOPIC_HINTS: Array<{ topic: string; pattern: RegExp }> = [
  { topic: "father", pattern: /\b(father|dad|your old man)\b/i },
  { topic: "past_relationship", pattern: /\b(?:are you|were you|have you (?:ever )?been) (?:married|dating|seeing (?:anyone|someone)|in love)\b|\byour (?:ex\b|ex-|husband|wife|boyfriend|girlfriend|marriage|love life|romantic|relationships?\b)|\bever (?:been )?(?:married|in love)\b/i },
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

/**
 * Is the operator asking Claire about Claire personally? Deliberately broader than the known-topic
 * table: a personal question with no canon topic ("Do you have siblings?", "Where do you live?")
 * must FAIL CLOSED into the guarded personal controller (unknown topic = approved decline) instead
 * of falling through to unrestricted generation, where the model could invent biography.
 * Business questions about "you" (your plan, your recommendation) do not match.
 */
const PERSONAL_SUBJECTS =
  "siblings?|brothers?|sisters?|kids?|children|family|parents?|mother|mom|mum|dad|married|marry|boyfriend|girlfriend|partner|dating|single|pets?|dogs?|cats?|hobb(?:y|ies)|music|songs?|movies?|films?|books?|shows?|food|cook|drink|drunk|smoke|sleep|dreams?|nightmares?|religio\\w*|god|pray|vote|politic\\w*|vacation|holidays?|paris|london|hometown|home|apartment|house|live|born|birthday|school|university|college|degree|friends?|afraid|scared|fears?|love|hate|regrets?|cry|cried|lonely|happy|sad|miss|childhood|tattoos?|nationality|accent|languages?|speak|singing|dance|sport|gym|workout|read|watch|listen";
const PERSONAL_PATTERNS: RegExp[] = [
  /\b(?:tell me about yourself|about you\b|who are you|what are you like|what(?:'s| is) your story)/i,
  new RegExp(`\\b(?:do|did|have|has|are|were|will|would|can|could)\\s+you\\b[^?.!]*\\b(?:${PERSONAL_SUBJECTS})\\b`, "i"),
  new RegExp(`\\b(?:where|what|who|which|how)\\b[^?.!]*\\b(?:do|did|are|were)\\s+you\\b[^?.!]*\\b(?:live|from|born|grow|grew|study|studied|come from|go to school|do for fun|like to|listen|watch|eat|drink|favou?rite|${PERSONAL_SUBJECTS})\\b`, "i"),
  new RegExp(`\\b(?:what|which|who)\\s+(?:kind of |type of |sort of )?(?:${PERSONAL_SUBJECTS})\\b[^?.!]*\\b(?:do|did|are|were|have)\\s+you\\b`, "i"),
  /\byour (?:favou?rite|family|mother|mom|mum|father|dad|parents|brother|sister|siblings?|childhood|hometown|home|birthday|age|ex|husband|wife|boyfriend|girlfriend|life|past|hobb(?:y|ies)|religion|politics|dreams?|fears?|regrets?|pets?|accent|nationality)\b/i,
  /\bhave you ever (?:been|lived|loved|cried|had|wanted|dated|seen|tried)\b/i,
];

export function isPersonalQuestionAboutClaire(utterance: string): boolean {
  return PERSONAL_PATTERNS.some(pattern => pattern.test(utterance));
}

export function detectClaireConversationalMode(
  utterance: string
): "operational" | "casual" | "personal" | "post_action_review" {
  if (detectRequestedClaireTopic(utterance) || isPersonalQuestionAboutClaire(utterance)) return "personal";
  if (/\b(how (?:did|does) that go|what happened with|after you (?:finish|done)|let me tell you what happened)\b/i.test(utterance)) {
    return "post_action_review";
  }
  if (/\b(how are you|what's new|good morning|good evening)\b/i.test(utterance)) return "casual";
  return "operational";
}
