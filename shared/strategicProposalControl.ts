/** Prepared-proposal control parsing is shared by Brain arbitration and the mutation boundary.
 * It never creates work or turns an ambiguous confirmation into whole-plan approval. */
export type StrategicProposalControl =
  | { kind: "approve"; selection: "all" | number[] }
  | {
      kind:
        | "reject"
        | "defer"
        | "why"
        | "numbers"
        | "alternative"
        | "economics"
        | "original"
        | "reminder"
        | "ambiguous";
    }
  | { kind: "title"; index: number; title: string }
  | { kind: "move"; index: number | null; weekday: number };
export function parseStrategicProposalControl(
  utterance: string
): StrategicProposalControl | null {
  const text = utterance.trim().replace(/[.!?]+$/, "");
  if (
    /^(?:approve (?:the )?(?:plan|proposal|all items)|accept (?:the )?(?:plan|proposal))$/i.test(
      text
    )
  )
    return { kind: "approve", selection: "all" };
  const selected = /^approve (?:only )?items? ([\d,\sand]+)$/i.exec(text);
  if (selected)
    return {
      kind: "approve",
      selection: [...new Set((selected[1]!.match(/\d+/g) ?? []).map(Number))],
    };
  const ordinals: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
  };
  const scope =
    /^(?:(?:only )?(?:add|approve|accept) (?:only )?(?:the )?((?:first|second|third|fourth|fifth)|(?:item \d+))(?: (?:one|item|mission))?|make (?:the )?((?:first|second|third|fourth|fifth)(?: item)?|item \d+) a mission)$/i.exec(
      text
    );
  if (scope) {
    const ref = (scope[1] ?? scope[2])!.toLowerCase();
    const n = /\d+/.exec(ref)?.[0];
    return {
      kind: "approve",
      selection: [n ? Number(n) : ordinals[ref.split(" ")[0]!]!],
    };
  }
  const title = /^change item (\d+) to (.+)$/i.exec(text);
  if (title)
    return { kind: "title", index: Number(title[1]), title: title[2]! };
  const move =
    /^(?:actually,?\s*)?move (?:item (\d+)|(?:that|this|the) (?:mission|item)) to (Monday|Tuesday|Wednesday|Thursday|Friday)$/i.exec(
      text
    );
  if (move)
    return {
      kind: "move",
      index: move[1] ? Number(move[1]) : null,
      weekday: ["monday", "tuesday", "wednesday", "thursday", "friday"].indexOf(
        move[2]!.toLowerCase()
      ),
    };
  if (
    /^(?:defer(?: (?:the )?(?:decision|plan|proposal))?|not now\b.*|(?:let'?s |we(?:'ll| will) )?(?:discuss|revisit|decide|talk about) (?:it|this|that) tomorrow.*)$/i.test(
      text
    )
  )
    return { kind: "defer" };
  if (
    /^(?:reject (?:the )?(?:plan|proposal)|no,? I (?:don'?t|do not) want to do that|cancel (?:the )?(?:plan|proposal|weekly planning))$/i.test(
      text
    )
  )
    return { kind: "reject" };
  if (/\b(?:why|explain|evidence)\b/i.test(text)) return { kind: "why" };
  // Broad "what should I do" questions get the full reasoning, even if they mention profit.
  if (/\b(?:what should (?:i|we) do|what(?:'s| is) happening|what do you recommend|what would you do)\b/i.test(text))
    return { kind: "why" };
  if (/\b(?:what numbers|which numbers|numbers.*bas(?:ing|ed))\b/i.test(text))
    return { kind: "numbers" };
  if (/\balternative(?:s)?\b/i.test(text)) return { kind: "alternative" };
  if (/\b(?:how do you know|make money|guarantee|profitable)\b/i.test(text))
    return { kind: "economics" };
  if (/\boriginal plan\b/i.test(text)) return { kind: "original" };
  if (/\b(?:didn'?t|did not) I already tell you\b/i.test(text))
    return { kind: "reminder" };
  if (
    /\b(?:make|add|approve|accept|move|change)\b.*\b(?:that|this|it|one|item|second|first)\b/i.test(
      text
    ) ||
    /^(?:yes|okay|ok|do it|go ahead)$/i.test(text)
  )
    return { kind: "ambiguous" };
  return null;
}
