import type { ConnectionView, JourneyKind } from "./firstTenMinutes";

/**
 * "Explore an example": invented businesses, each labelled as such on every screen. Nina's flower studio follows
 * Astra's script for "The Friday That Didn't Exist"; Dev's electrical business, her "The Estimate That Wouldn't Fit"
 * (docs/goldline/FIRST_TEN_MINUTES_BUILD.md). Every address uses the reserved `.example` domain, so nothing here can
 * ever reach a real inbox.
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

export const DEV_EXAMPLE_BUSINESS = {
  owner: "Dev",
  ownerFullName: "Dev Mistry",
  businessName: "Northfield Electric",
  email: "dev@northfieldelectric.example",
} as const;

export type ExampleKey = "nina" | "dev";

export type ExampleBusiness = {
  key: ExampleKey;
  kind: JourneyKind;
  owner: string;
  businessName: string;
  label: string;
  connection: ConnectionView;
};

export const EXAMPLES: Record<ExampleKey, ExampleBusiness> = {
  nina: { key: "nina", kind: "example", owner: EXAMPLE_BUSINESS.owner, businessName: EXAMPLE_BUSINESS.businessName, label: EXAMPLE_LABEL, connection: EXAMPLE_CONNECTION },
  dev: {
    key: "dev",
    kind: "example_dev",
    owner: DEV_EXAMPLE_BUSINESS.owner,
    businessName: DEV_EXAMPLE_BUSINESS.businessName,
    label: "Example: Dev's electrical business, invented. Nothing here is yours.",
    connection: { ...EXAMPLE_CONNECTION, account: DEV_EXAMPLE_BUSINESS.email },
  },
};

/** Which invented business a journey explores, or null for the person's own. */
export function exampleOf(kind: JourneyKind): ExampleBusiness | null {
  return kind === "example" ? EXAMPLES.nina : kind === "example_dev" ? EXAMPLES.dev : null;
}

export function isExampleKind(kind: JourneyKind): boolean {
  return exampleOf(kind) !== null;
}
