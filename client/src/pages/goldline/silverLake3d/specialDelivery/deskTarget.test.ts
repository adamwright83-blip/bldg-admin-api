import { describe, expect, it } from "vitest";
import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";
import { pickDeskTarget } from "./deskTarget";

const target = (customerId: string, over: Record<string, unknown> = {}) =>
  ({
    customerId,
    hasConsent: true,
    status: "open",
    communicationState: "not_started",
    silverLakeStatus: { message: null },
    ...over,
  }) as unknown as CozyProjectedTarget;

describe("Rook's desk shows one real situation", () => {
  it("never offers someone the operator may not contact, or who already accepted or was observed receiving a message", () => {
    const targets = [
      target("no_consent", { hasConsent: false }),
      target("accepted", { status: "accepted" }),
      target("observed", { communicationState: "send_observed" }),
      target("blocked", { communicationState: "consent_blocked" }),
    ];
    expect(pickDeskTarget(targets, null)).toBeNull();
    expect(pickDeskTarget([...targets, target("ok")], null)?.customerId).toBe(
      "ok"
    );
  });

  it("keeps the letter saved at the desk first, then one already under way, then the mission's next", () => {
    const targets = [
      target("first"),
      target("underway", {
        silverLakeStatus: { message: "compose_handoff_opened" },
      }),
      target("saved"),
    ];
    expect(pickDeskTarget(targets, { customerId: "saved" })?.customerId).toBe(
      "saved"
    );
    expect(pickDeskTarget(targets, null)?.customerId).toBe("underway");
    expect(
      pickDeskTarget([target("first"), target("second")], null)?.customerId
    ).toBe("first");
  });

  it("does not bring back a saved letter for someone who can no longer be contacted", () => {
    expect(
      pickDeskTarget([target("saved", { hasConsent: false }), target("next")], {
        customerId: "saved",
      })?.customerId
    ).toBe("next");
  });
});
