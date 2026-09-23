/**
 * Overworld consumer for post-Rook. The route opens only when both
 * server-recorded values are true. A missing read, an unearned flag,
 * or a single true value stays closed.
 */
export function overworldPostRookOpen(
  read:
    | {
        levelColosseumResolved: { value: boolean };
        companionRookOwned: { value: boolean };
      }
    | null
    | undefined
): boolean {
  return read?.levelColosseumResolved.value === true && read?.companionRookOwned.value === true;
}
