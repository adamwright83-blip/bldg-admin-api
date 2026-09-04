/**
 * Shared vocabulary for the Hustler Lever.
 *
 * The two directions live here rather than on the server router so the client
 * cannot drift out of sync with what `pull` will actually accept.
 */
export const LEVER_PULLS = ["warm", "big_swing"] as const;
export type LeverPull = (typeof LEVER_PULLS)[number];
