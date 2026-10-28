/**
 * Deterministic brevity for a spoken reply.
 *
 * The prompt asks for "at most three short sentences, one question at most".
 * A prompt line is a request; this is the enforcement. It keeps sentence order,
 * never rewrites a sentence, and never invents one. When a cap would leave
 * nothing, the caller's fallback is used instead.
 */

export type SpokenReplyCap = {
  /** Maximum sentences kept, questions included. */
  maxSentences: number;
  /** Maximum question sentences kept. 0 removes every question. */
  maxQuestions: number;
  /**
   * A question that must survive if present (an approval ask the server holds
   * pending). It counts toward both caps and is kept over earlier questions.
   */
  keepQuestion?: string | null;
};

export function splitSpokenSentences(text: string): string[] {
  return (
    text
      .match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g)
      ?.map(part => part.trim())
      .filter(Boolean) ?? []
  );
}

export function isQuestionSentence(sentence: string): boolean {
  return /\?["']?$/.test(sentence.trim());
}

export function countQuestions(text: string): number {
  return splitSpokenSentences(text).filter(isQuestionSentence).length;
}

export function capSpokenReply(text: string, cap: SpokenReplyCap): string {
  const sentences = splitSpokenSentences(text);
  if (!sentences.length) return "";
  const keep = cap.keepQuestion?.trim() || null;

  // Questions first: decide which survive, then cut statements to the budget.
  const questionIdx = sentences
    .map((s, i) => (isQuestionSentence(s) ? i : -1))
    .filter(i => i >= 0);
  const survivingQuestions = new Set<number>();
  // The held approval ask survives even when maxQuestions is 0: it is the one
  // question the server is actually waiting on.
  const keepIdx = keep
    ? questionIdx.find(i => sentences[i]!.includes(keep))
    : undefined;
  if (keepIdx !== undefined) survivingQuestions.add(keepIdx);
  for (const i of questionIdx) {
    if (survivingQuestions.size >= cap.maxQuestions) break;
    survivingQuestions.add(i);
  }
  const statementBudget = Math.max(
    0,
    cap.maxSentences - survivingQuestions.size
  );

  const out: string[] = [];
  let statements = 0;
  for (let i = 0; i < sentences.length; i += 1) {
    const sentence = sentences[i]!;
    if (isQuestionSentence(sentence)) {
      if (survivingQuestions.has(i)) out.push(sentence);
      continue;
    }
    if (statements < statementBudget) {
      out.push(sentence);
      statements += 1;
    }
  }
  return out.join(" ").trim();
}
