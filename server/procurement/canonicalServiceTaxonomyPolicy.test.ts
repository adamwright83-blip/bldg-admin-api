import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_SERVICE_CATEGORIES,
  canonicalizeServiceIntent,
  getCanonicalServiceDefinition,
} from "./canonicalServiceTaxonomyPolicy";

describe("canonical service taxonomy policy", () => {
  it.each([
    ["laundry", "laundry"], ["wash_fold", "laundry"], ["laundry_pickup", "laundry"],
    ["dry-cleaning-request", "dry_cleaning"], ["dry_cleaning", "dry_cleaning"],
    ["dog-grooming-request", "dog_grooming"], ["grooming", "dog_grooming"],
    ["car-wash-request", "car_detail"], ["car-wash", "car_detail"],
    ["airport-transport-request", "airport_transport"],
    ["cleaning-request", "apartment_cleaning"],
    ["guest-preparation-request", "guest_readiness"],
    ["haircut", "haircut"], ["handyman", "handyman"], ["other", "other"],
  ] as const)("maps existing intent %s to %s", (source, category) => {
    expect(canonicalizeServiceIntent(source)).toMatchObject({ category, recognized: true, bookingMayBeInferred: false });
  });

  it("fails unknown and missing intent into manual review without inventing a category", () => {
    expect(canonicalizeServiceIntent("pet psychic")).toMatchObject({
      category: "other", recognized: false, requestPath: "manual_review",
      reasons: ["service_intent_unrecognized"], bookingMayBeInferred: false,
    });
    expect(canonicalizeServiceIntent(null).reasons).toEqual(["service_intent_missing"]);
  });

  it("keeps every category behind provider confirmation", () => {
    expect(CANONICAL_SERVICE_CATEGORIES).toHaveLength(10);
    for (const category of CANONICAL_SERVICE_CATEGORIES) {
      expect(getCanonicalServiceDefinition(category)).toMatchObject({
        providerConfirmationRequired: true, bookingMayBeInferred: false,
      });
    }
  });

  it("contains no IO, DB, route, UI, worker, LLM, or execution wiring", () => {
    const source = readFileSync("server/procurement/canonicalServiceTaxonomyPolicy.ts", "utf8");
    expect(source).not.toMatch(/\b(fetch|axios|execute|query|insert|update|delete|invokeLLM)\s*\(/i);
    expect(source).not.toMatch(/\b(Router|worker|connector|stripe|twilio|sendgrid|openai|anthropic)\b/i);
    expect(source).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i);
  });
});
