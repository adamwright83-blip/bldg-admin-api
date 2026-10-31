import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CPE_SHOTGUN_APPROVAL,
  shotgunSubmission,
} from "../../../shared/centuryParkShotgun";
import { shotgunDraft } from "../../../shared/centuryParkShotgunDraft";
import { submissionFingerprint } from "./service";
import { shotgunStore } from "./store";

const c = {
  identityId: "phone:2135550100",
  name: "Chloe Fixture",
  daysSinceLastOrder: 72,
  paidOrders: 6,
  lifetimeCents: 21800,
  lastOrderDate: "2026-08-13",
  lastOrderSummary: "wash and fold",
};

describe("Century Park shotgun boundary", () => {
  it("fails closed without durable storage, including under test; there is no memory success mode", async () => {
    await expect(shotgunStore.list("test_tenant")).rejects.toThrow(
      /durable database/
    );
    await expect(
      shotgunStore.byRequest("test_tenant", randomUUID())
    ).rejects.toThrow(/durable database/);
  });
  it("a no-offer draft makes no credit, free-service, area-coverage or pickup-reservation claim", () => {
    for (const hypothesis of [
      "moved",
      "seasonal",
      "price",
      "bad_experience",
      "forgot",
    ] as const) {
      const text = shotgunDraft(
        c,
        { openingId: "regular", hypothesis },
        "Laundry Fixture"
      );
      expect(text).toContain("Laundry Fixture");
      expect(text).not.toMatch(
        /credit|free pickup|on me|we'll be there|cover most|confirmed|fulfilled/i
      );
      expect(text).not.toMatch(/shotgun|zombie|chip|hypothesis/i);
    }
    expect(() =>
      shotgunDraft(
        { ...c, paidOrders: 1 },
        { openingId: "regular", hypothesis: "forgot" },
        "Fixture"
      )
    ).toThrow(/not supported/);
  });
  it("requires exact operator approval and refuses caller-supplied tenant or result authority", () => {
    const input = {
      requestId: randomUUID(),
      customerId: c.identityId,
      openingId: "regular",
      hypothesis: "seasonal",
      shell: "none",
      messageBody: "prepared",
      scheduledFor: "2026-10-28T18:00:00Z",
      confirmation: CPE_SHOTGUN_APPROVAL,
    };
    expect(shotgunSubmission.safeParse(input).success).toBe(true);
    for (const field of [
      "tenantId",
      "operatorId",
      "fulfilled",
      "authorityReceiptId",
      "causedSale",
    ]) {
      expect(
        shotgunSubmission.safeParse({ ...input, [field]: "forged" }).success
      ).toBe(false);
    }
    expect(
      shotgunSubmission.safeParse({ ...input, confirmation: "yes" }).success
    ).toBe(false);
    expect(
      shotgunSubmission.safeParse({
        ...input,
        scheduledFor: "2026-10-28T11:00:00",
      }).success
    ).toBe(false);
  });
  it("recognizes the same approval despite a new request id, JSON property order or equivalent UTC offset", () => {
    const input = shotgunSubmission.parse({
      requestId: randomUUID(),
      customerId: c.identityId,
      openingId: "regular",
      hypothesis: "seasonal",
      shell: "none",
      messageBody: "prepared",
      scheduledFor: "2026-10-28T18:00:00Z",
      confirmation: CPE_SHOTGUN_APPROVAL,
    });
    expect(submissionFingerprint(input)).toBe(
      submissionFingerprint({
        ...input,
        requestId: randomUUID(),
        scheduledFor: "2026-10-28T11:00:00-07:00",
      })
    );
    expect(submissionFingerprint(input)).not.toBe(
      submissionFingerprint({ ...input, messageBody: "changed" })
    );
  });
});
