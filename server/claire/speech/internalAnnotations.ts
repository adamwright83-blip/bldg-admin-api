/**
 * Internal annotations never reach the operator's ear.
 *
 * The model sees Claire's earlier turns tagged "[Playback unconfirmed]" / "[Playback interrupted]"
 * (conversationHistoryForModel) so it knows they may not have been heard. On 2026-10-28 (call
 * cb980810) it copied the tag into its own reply twice and Twilio read it aloud.
 */

const PLAYBACK_TAG = /\[\s*playback\s+(?:unconfirmed|interrupted|confirmed)\s*\]\s*/gi;
/** A bracketed label at the very start of a reply ("[Note] …") is never speech. */
const LEADING_LABEL = /^\s*\[[A-Za-z][A-Za-z ]{1,40}\]\s*/;

export function stripInternalAnnotations(text: string): string {
  return text.replace(PLAYBACK_TAG, "").replace(LEADING_LABEL, "").replace(/\s{2,}/g, " ").trim();
}

const REPEAT_LEAD = /^(?:my question(?: was)?|i asked|one (?:last |more )?question|short version|quick question)\s*:\s*/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=["'A-Z0-9])/)
    .map(part => part.trim())
    .filter(Boolean);
}

/**
 * What Claire says when the operator did not hear her.
 *
 * Production 2026-10-28 (call fffb8882): the repeat replayed the whole previous turn, which opened
 * with two sentences of preamble and put the question last. Adam cut in during the preamble four
 * times and never heard the question. A repeat leads with the question itself, or, without one,
 * the last two sentences.
 */
export function repeatSpeech(previous: string): string {
  const clean = stripInternalAnnotations(previous).replace(REPEAT_LEAD, "").trim();
  if (!clean) return "";
  const parts = sentences(clean);
  const question = [...parts].reverse().find(part => part.endsWith("?"));
  // Case is left alone: the question may open with a name, and the voice does not hear case.
  if (question) return `My question: ${question.replace(REPEAT_LEAD, "")}`;
  return parts.length <= 2 ? clean : parts.slice(-2).join(" ");
}
