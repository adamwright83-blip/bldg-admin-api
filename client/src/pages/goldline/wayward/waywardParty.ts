/**
 * Is Rook physically aboard the Wayward? Fails closed.
 *
 * Durable Rook ownership belongs to the server progression read
 * (`goldlineProgression.get` → `companionRookOwned`, drafted in PRs #227/#240,
 * not on main yet). Until a caller passes that read in, production shows the
 * Wayward without him: Trailblazer can still cross the broken span, but the
 * outer tether stays sealed, because only Rook can talk the inspectors off it.
 *
 * What is deliberately NOT evidence here:
 *   - the same-device party cache (`goldlineParty.ts`, localStorage);
 *   - the local Colosseum resolution flag;
 *   - `capability.rook.contact` (a product capability, not the companion);
 *   - five Greystar visits.
 *
 * The only other way aboard is the explicit preview seam: the standalone
 * preview harness and the compile-time Goldline test harness. Production mounts
 * never construct it (colosseumTruthBoundary-style guard in waywardTruth.test.ts).
 */

/** The server's tri-state read, as `goldlineProgression.get` publishes it. */
export type ServerCompanionRead = {
  status: "earned" | "unearned" | "uncertain";
  value: boolean;
};

export type WaywardRookSource =
  | { kind: "server"; companionRookOwned: ServerCompanionRead | null | undefined }
  | { kind: "preview"; reason: "wayward-preview-harness" | "goldline-test-harness" };

export function rookAboard(source: WaywardRookSource | null | undefined): boolean {
  if (!source) return false;
  if (source.kind === "preview") return true;
  const read = source.companionRookOwned;
  return read?.status === "earned" && read.value === true;
}
