/** Narrow authority veto for feedback about Claire's responsibility. It never grants authority. */
export function isClaireRoleFeedback(text: string): boolean {
  // Quoted reports and hypothetical role discussions do not admit a preference.
  if (
    /^(?:if|suppose|imagine|someone|he said|she said|they said|quote)\b/i.test(
      text.trim()
    ) ||
    /["“”]/.test(text)
  )
    return false;
  return (
    /\b(?:you(?:'re| are)?\s+(?:supposed|meant|expected)\s+to|you\s+(?:should|need to)\s+(?:be\s+)?(?:proactiv\w*|prepar\w*|planning)|your\s+(?:job|role|responsibility)|chief of staff)\b/i.test(
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
