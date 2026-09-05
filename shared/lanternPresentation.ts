/**
 * HOW BRIGHTLY A REAL CUSTOMER'S LANTERN BURNS.
 *
 * Four visually distinguishable lanterns over three business states:
 *
 *   BRIGHT   active, and a genuinely recurring roughly-weekly cadence is PROVEN
 *            by enough real order dates to measure an interval
 *   NORMAL   active, but weekly cadence is not proven
 *   DIM      the existing `dimming` state
 *   DARK     the existing `dark` state
 *
 * BRIGHT IS NOT A BUSINESS STATE
 *
 * This module adds no fourth value to `LanternState` and cannot change one. It
 * is a pure projection over a cadence that has already been computed by
 * `inferCustomerCadence`, and it only ever splits `active` in two. A customer's
 * commercial standing is identical whether their lantern is bright or normal —
 * the difference is how confident the world is allowed to look about them.
 *
 * That split matters because the two look nothing alike in the data and
 * identical on screen today: a customer who has ordered every Tuesday for eight
 * months and a customer who ordered once last week are both "active", and
 * drawing them the same way throws away the single most useful thing the
 * cadence classifier knows.
 *
 * WHY IT CANNOT BE FAKED FROM A SPREADSHEET
 *
 * BRIGHT requires `confidence === "measured"`, which `inferCustomerCadence` only
 * returns when it saw at least three distinct order dates and could derive two
 * or more intervals from them. A row carrying `Total orders: 38` and a recent
 * `Last Order` proves neither — lifetime volume is not a rhythm, and a single
 * recent date is not an interval. Such a customer is NORMAL, and the test suite
 * pins that case specifically, because it is exactly the shortcut a future
 * change would reach for.
 */
import type { CustomerCadence } from "./lanternCity";

export type LanternPresentation = "bright" | "normal" | "dim" | "dark";

/**
 * What "weekly" means, in one place.
 *
 * A band rather than exactly 7, because real people are not metronomes: a
 * fortnightly customer who slipped, or a weekly customer who occasionally
 * skips a Sunday, still reads as weekly to anyone looking at the orders. The
 * band is deliberately narrow enough to exclude fortnightly (14) and monthly
 * (~30) rhythms, which are genuinely different relationships.
 *
 * Inclusive at both ends.
 */
export const WEEKLY_CADENCE_DAYS = { min: 4, max: 10 } as const;

/** Whether a measured median interval counts as a weekly rhythm. */
export function isWeeklyCadence(expectedCadenceDays: number | null): boolean {
  if (expectedCadenceDays === null) return false;
  if (!Number.isFinite(expectedCadenceDays)) return false;
  return (
    expectedCadenceDays >= WEEKLY_CADENCE_DAYS.min &&
    expectedCadenceDays <= WEEKLY_CADENCE_DAYS.max
  );
}

/**
 * The lantern a cadence earns.
 *
 * Order of checks is the whole contract: dormancy and cooling are read from the
 * business state FIRST, so no amount of measured history can brighten a
 * customer who has stopped ordering. A customer with a perfect weekly rhythm
 * for two years who then vanishes for three months is DARK, not bright.
 */
export function projectLanternPresentation(
  cadence: CustomerCadence
): LanternPresentation {
  if (cadence.state === "dark") return "dark";
  if (cadence.state === "dimming") return "dim";
  // Active. Bright only when the rhythm was actually measured, not assumed.
  return cadence.confidence === "measured" &&
    isWeeklyCadence(cadence.expectedCadenceDays)
    ? "bright"
    : "normal";
}

/**
 * Plain language for the presentation, so brightness is never the only channel
 * carrying the fact. A reader who cannot distinguish two shades of gold still
 * gets told what the world is claiming.
 */
export function describeLanternPresentation(
  presentation: LanternPresentation
): string {
  switch (presentation) {
    case "bright":
      return "Ordering weekly";
    case "normal":
      return "Active";
    case "dim":
      return "Cooling off";
    case "dark":
      return "Dormant";
  }
}

/**
 * The three cadence states map onto lantern ARTWORK, which has only three
 * pieces. Bright and normal share the lit lantern and differ in how it burns —
 * halo, core intensity, window spill — rather than in which object is drawn,
 * because they are the same customer in the same building.
 */
export function lanternArtStateFor(
  presentation: LanternPresentation
): "active" | "dimming" | "dark" {
  if (presentation === "dark") return "dark";
  if (presentation === "dim") return "dimming";
  return "active";
}
