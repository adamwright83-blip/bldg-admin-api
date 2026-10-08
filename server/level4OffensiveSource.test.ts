import { it, expect } from "vitest";
import {
  offensiveActionFromState,
  offensiveCopyFromState,
} from "./level4OffensiveSource";
import type { Level4OffensiveState } from "./level4Offensive";
const state: Level4OffensiveState = {
  dbAvailable: true,
  buildingPenetration: [],
  referralRequest: {
    block: "referral_request",
    userId: 101,
    firstName: "Ada",
    lastInitial: "L",
    orderCount: 3,
    ltvCents: 12600,
  },
  marketHole: { block: "market_hole", status: "stubbed_for_v1" },
};
const generatedCopy = {
  headline: "Referral",
  body: "Request",
  primaryCopy: "Request",
  internalNote: "Request",
  deliverable: "sms" as const,
  brandId: "default" as const,
};
it("uses durable projected facts instead of browser-supplied customer/count/dollar values", () => {
  expect(
    offensiveActionFromState(
      {
        block: "referral_request",
        userId: 101,
        firstName: "Invented",
        lastInitial: "Z",
        orderCount: 900,
        ltvCents: 900000,
        generatedCopy,
      },
      state
    )
  ).toMatchObject({
    firstName: "Ada",
    lastInitial: "L",
    orderCount: 3,
    ltvCents: 12600,
  });
  expect(
    offensiveCopyFromState(
      {
        block: "referral_request",
        brand: "default",
        payload: {
          firstName: "Ada",
          lastInitial: "L",
          orderCount: 900,
          ltvCents: 900000,
        },
      },
      state
    )
  ).toMatchObject({ payload: { orderCount: 3, ltvCents: 12600 } });
});
it("rejects a foreign/stale customer and a held unknown-value referral", () => {
  expect(() =>
    offensiveActionFromState(
      {
        block: "referral_request",
        userId: 102,
        firstName: "Ada",
        lastInitial: "L",
        orderCount: 3,
        ltvCents: 12600,
        generatedCopy,
      },
      state
    )
  ).toThrow("source changed");
  expect(() =>
    offensiveCopyFromState(
      {
        block: "referral_request",
        brand: "default",
        payload: {
          firstName: "Other",
          lastInitial: "L",
          orderCount: 3,
          ltvCents: 12600,
        },
      },
      state
    )
  ).toThrow("source changed");
  expect(() =>
    offensiveActionFromState(
      {
        block: "referral_request",
        userId: 101,
        firstName: "Ada",
        lastInitial: "L",
        orderCount: 3,
        ltvCents: 12600,
        generatedCopy,
      },
      {
        ...state,
        referralRequest: { block: "referral_request", candidate: null },
      }
    )
  ).toThrow("source changed");
});
