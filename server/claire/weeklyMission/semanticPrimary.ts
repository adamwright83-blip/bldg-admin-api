/**
 * Boundary between conversational speech and durable Weekly Mission primaries.
 *
 * A weekly primary is a normalized action label, never a transcript fragment.
 * Model output and deterministic fallbacks both pass this gate before the draft
 * can change. Ambiguity fails closed: leaving the day open is safer than
 * persisting conversation as work.
 */

const QUESTION_OPEN =
  /^(?:what|why|who|when|where|how|do|does|did|is|are|was|were|can|could|would|should|will|have|has)\b/i;
const FIRST_PERSON =
  /\b(?:i|i'm|i’m|i've|i’ve|i'll|i’ll|me|my|mine|we|we're|we’re|we've|we’ve|we'll|we’ll|our|ours)\b/i;
const CONVERSATION_META =
  /\b(?:what do you mean|what are you saying|i don't understand|i dont understand|great idea|sounds good|got it|thank you|thanks|hold on|wait|pause|stop|say that again|repeat that)\b/i;
const ACTION_OR_WORK_NOUN =
  /\b(?:call|follow\s*up|visit|walk|sell|sales|pitch|send|text|email|message|deliver|drop\s*off|pick\s*up|pickup|process|wash|fold|invoice|bill|collect|prepare|build|draft|write|finish|review|repair|fix|research|plan|route|payroll|recovery|outreach|proposal|inspection|mission|meeting|order|customer|account)\b/i;
const STATUS_ONLY =
  /\b(?:is|are|was|were|am|seems|looks|feels|has|have)\b/i;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isSemanticallyNormalizedPrimary(
  candidate: string,
  sourceUtterance?: string | null
): boolean {
  const text = candidate.replace(/\s+/g, " ").trim();
  if (!text || text.length > 160) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 14) return false;
  if (/\?/.test(text) || QUESTION_OPEN.test(text)) return false;
  if (FIRST_PERSON.test(text) || CONVERSATION_META.test(text)) return false;

  // A normalized action title should not simply be a conversational sentence
  // copied back unchanged. Short labels such as "Payroll" remain valid.
  if (sourceUtterance) {
    const source = normalize(sourceUtterance);
    const normalizedCandidate = normalize(text);
    const sourceWords = source.split(/\s+/).filter(Boolean);
    if (sourceWords.length > 4 && normalizedCandidate === source) return false;
  }

  // Longer state descriptions are context, not missions. Short noun labels are
  // allowed; longer candidates need an action/work anchor.
  if (STATUS_ONLY.test(text) && !ACTION_OR_WORK_NOUN.test(text)) {
    return false;
  }
  if (words.length > 4 && !ACTION_OR_WORK_NOUN.test(text)) return false;

  return true;
}
