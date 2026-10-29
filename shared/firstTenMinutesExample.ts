import type { ConnectionView } from "./firstTenMinutes";

/**
 * "Explore an example": Nina's flower studio, invented for this example and labelled as such on every screen.
 * Her details follow Astra's script (docs/goldline/FIRST_TEN_MINUTES_BUILD.md). Every address uses the reserved
 * `.example` domain, so nothing here can ever reach a real inbox.
 */
export const EXAMPLE_BUSINESS = {
  owner: "Nina",
  ownerFullName: "Nina Vale",
  businessName: "Wildroot Flowers",
  email: "nina@wildrootflowers.example",
} as const;

export const EXAMPLE_LABEL = "Example: Nina's flower studio, invented. Nothing here is yours.";

export const EXAMPLE_CONNECTION: ConnectionView = {
  provider: "google",
  account: EXAMPLE_BUSINESS.email,
  connectedAt: "2026-10-01T09:00:00.000Z",
  products: ["gmail", "calendar", "drive"],
};
