/**
 * "I'll do it tomorrow."
 *
 * On the 2026-10-27 evening call Claire put the Dana follow-up on TODAY's Day
 * Line and announced it; Adam then said he would do it tomorrow, and the row
 * stayed on today. The grant adapter reads the day only from the turn that
 * created the row, so a deferral spoken one turn later never moved anything.
 *
 * This module is the memory of what Claire just placed and the reading of a
 * plain deferral. It decides nothing about business truth: the move itself is
 * a Day Director write with its own receipt.
 */

export type RecentDayLineCommit = {
  ids: string[];
  title: string;
  businessDate: string;
  atMs: number;
};

/** A deferral spoken within this window still refers to what Claire just placed. */
export const RECENT_COMMIT_WINDOW_MS = 30 * 60_000;

const DEFERRAL = new RegExp(
  [
    String.raw`\b(?:i(?:'ll| will| can| am going to|'m going to|'m gonna| gonna)|let'?s|we(?:'ll| will| can))\s+(?:just\s+|probably\s+|maybe\s+)?(?:do|handle|send|get to|take care of|deal with|knock out|hit|tackle|finish|write|draft|email|text|call)\s+(?:it|that|this|them|those|the\s+\w+(?:\s+\w+)?)?\s*(?:in the morning|tomorrow(?:\s+morning)?|first thing)\b`,
    String.raw`^(?:tomorrow|not tonight|in the morning|first thing tomorrow|tomorrow morning)[.!]?$`,
    String.raw`\b(?:leave|push|move|bump|save|put)\s+(?:it|that|this|them)\s+(?:to|till|until|for|on)\s+(?:tomorrow|the morning)\b`,
    String.raw`\b(?:i'?ll|i will)\s+(?:do|get to)\s+(?:it|that|this)\s+tomorrow\b`,
    String.raw`\btomorrow\s+(?:then|instead|works)\b`,
  ].join("|"),
  "i"
);

const KEEPS_TONIGHT = /\b(?:tonight|right now|now|today)\b/i;

/** True when the operator is pushing the thing Claire just placed to tomorrow. */
export function deferralToTomorrow(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (!DEFERRAL.test(trimmed)) return false;
  // "I'll do it tonight, not tomorrow" keeps the item where it is.
  return !(KEEPS_TONIGHT.test(trimmed) && !/\bnot\s+tonight\b/i.test(trimmed));
}

/** What Claire placed on `today`'s line recently enough for a deferral to mean it. */
export function recentDayLineCommits(
  commits: readonly RecentDayLineCommit[] | undefined,
  input: { nowMs: number; today: string }
): RecentDayLineCommit[] {
  return (commits ?? []).filter(
    commit =>
      commit.businessDate === input.today &&
      commit.ids.length > 0 &&
      input.nowMs - commit.atMs <= RECENT_COMMIT_WINDOW_MS
  );
}

const TARGET_STOPWORDS = new Set([
  "follow",
  "with",
  "that",
  "this",
  "from",
  "into",
  "then",
  "them",
  "they",
  "will",
  "just",
  "tomorrow",
  "morning",
  "tonight",
  "email",
  "text",
  "call",
  "visit",
  "pitch",
  "send",
  "check",
  "drop",
  "pick",
  "the",
  "and",
  "for",
  "about",
]);

function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map(token => token.replace(/'s$/, ""))
    .filter(token => token.length >= 4 && !TARGET_STOPWORDS.has(token));
}

/**
 * Which recent commit a deferral means. A name from one commit's title in the
 * operator's words ("the Dana email") picks that commit; otherwise the deferral
 * means the one Claire placed most recently. Never every recent commit: three
 * unrelated rows placed in the same half hour are three decisions, not one.
 */
export function deferralTarget(
  commits: readonly RecentDayLineCommit[],
  utterance: string
): RecentDayLineCommit | null {
  if (!commits.length) return null;
  const words = new Set(
    utterance
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .map(token => token.replace(/'s$/, ""))
      .filter(Boolean)
  );
  const named = commits.filter(commit =>
    titleTokens(commit.title).some(token => words.has(token))
  );
  const pool = named.length ? named : commits;
  return pool.reduce((latest, commit) =>
    commit.atMs >= latest.atMs ? commit : latest
  );
}

export function rememberDayLineCommit(
  commits: readonly RecentDayLineCommit[] | undefined,
  commit: RecentDayLineCommit
): RecentDayLineCommit[] {
  return [...(commits ?? []), commit].slice(-6);
}
