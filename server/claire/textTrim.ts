/**
 * PR1 Claire Intelligence Repair -- shared sentence-boundary trim, used by
 * every Claire conversational generation path instead of a hard character
 * slice (which was cutting real answers off mid-sentence/mid-word). Only
 * trims if genuinely over budget, and only at a sentence boundary.
 */
export function trimToSentenceBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastBoundary = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? ")
  );
  return lastBoundary > maxChars * 0.4 ? slice.slice(0, lastBoundary + 1) : slice;
}
