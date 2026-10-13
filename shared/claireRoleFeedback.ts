/** Narrow authority veto for feedback about Claire's responsibility. It never grants authority. */
export function isClaireRoleFeedback(text: string): boolean {
  return (
    /\b(?:you(?:'re| are)?\s+(?:supposed|meant|expected)\s+to|your\s+(?:job|role|responsibility)|chief of staff)\b/i.test(
      text
    ) &&
    /\b(?:proactiv\w*|prepar\w*|planning|plan|recommend\w*|work|thinking)\b/i.test(
      text
    ) &&
    !/\b(?:add|put|save|schedule)\s+(?:this|that|it|these|those)\s+(?:to|on|in)\s+(?:the\s+)?day\s*line\b/i.test(
      text
    )
  );
}
