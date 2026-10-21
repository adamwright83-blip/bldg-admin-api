/**
 * Test data never reaches a briefing Claire reads aloud.
 *
 * Production 2026-10-19/20: a native order for "Jojo Test" (orders.id 706) sat on the Day Line and was
 * spoken on two calls, and two follow-ups on the account "CODEX PROPERTY MISSION E2E … SAFE TO ARCHIVE"
 * are still open. This guard is a READ-side filter on what Claire speaks. It deletes nothing and does not
 * hide the row from the Day Line board; the prod clean-up is in scripts/dayline/close-duplicate-dana.md.
 */
const TEST_TITLE = /\btest(?:ing)?\b/i;
const FIXTURE_MARKERS = /\b(?:e2e|synthetic|fixture|safe to archive|codex property mission|qa only)\b/i;

export function isTestFixtureTitle(...texts: Array<string | null | undefined>): boolean {
  return texts.some(text => Boolean(text) && (TEST_TITLE.test(text!) || FIXTURE_MARKERS.test(text!)));
}

export function withoutTestFixtures<T>(items: T[], textsOf: (item: T) => Array<string | null | undefined>): { kept: T[]; withheld: T[] } {
  const kept: T[] = [];
  const withheld: T[] = [];
  for (const item of items) (isTestFixtureTitle(...textsOf(item)) ? withheld : kept).push(item);
  return { kept, withheld };
}
