import { describe, expect, it } from "vitest";
import {
  assertGroundedWinBackMessage,
  buildWinBackDraft,
  scoreCustomerChurn,
  type CustomerHistoryObservation,
} from "./customerChurn";

const history = (
  dates: string[],
  weights?: number[],
  valueCents = 6_500
): CustomerHistoryObservation[] =>
  dates.map((serviceAt, index) => ({
    orderId: index + 1,
    serviceAt,
    valueCents,
    weightLbs: weights?.[index] ?? 20,
    serviceType: "wash_fold",
  }));

describe("customer churn scoring", () => {
  it("raises a valuable regular to high risk after three normal gaps", () => {
    const score = scoreCustomerChurn({
      customerKey: "customer-1",
      customerName: "Marisol Vega",
      history: history(
        [
          "2026-01-01T00:00:00.000Z",
          "2026-01-15T00:00:00.000Z",
          "2026-01-29T00:00:00.000Z",
          "2026-02-12T00:00:00.000Z",
          "2026-02-26T00:00:00.000Z",
          "2026-03-12T00:00:00.000Z",
        ],
        undefined,
        50_000
      ),
      now: new Date("2026-05-01T00:00:00.000Z"),
    });
    expect(score.grade).toBe("high");
    expect(score.confidence).toBe("high");
    expect(score.recommendedAction).toBe("contact_now");
  });

  it("suppresses outreach while the customer has an active order", () => {
    const score = scoreCustomerChurn({
      customerKey: "customer-1",
      customerName: "Marisol Vega",
      history: history([
        "2026-01-01T00:00:00.000Z",
        "2026-01-15T00:00:00.000Z",
        "2026-01-29T00:00:00.000Z",
      ]),
      activeOrderCount: 1,
      now: new Date("2026-05-01T00:00:00.000Z"),
    });
    expect(score.score).toBeLessThanOrEqual(25);
    expect(score.recommendedAction).toBe("watch");
  });

  it("requires enough real history to infer a cadence", () => {
    expect(() =>
      scoreCustomerChurn({
        customerKey: "customer-1",
        customerName: "Marisol Vega",
        history: history(["2026-01-01T00:00:00.000Z"]),
      })
    ).toThrow(/two completed orders/);
  });

  it("drafts a grounded message without inventing a discount", () => {
    const score = scoreCustomerChurn({
      customerKey: "customer-1",
      customerName: "Marisol Vega",
      history: history([
        "2026-01-01T00:00:00.000Z",
        "2026-01-15T00:00:00.000Z",
        "2026-01-29T00:00:00.000Z",
      ]),
      now: new Date("2026-03-20T00:00:00.000Z"),
    });
    const draft = buildWinBackDraft({
      score,
      storeName: "Sunset Laundry",
      senderName: "Mike",
      lastServiceLabel: "wash & fold",
    });
    expect(draft.message).toContain("wash & fold order on Jan 29");
    expect(draft.message).not.toMatch(/discount|coupon|% off/i);
    expect(draft.requiresHumanApproval).toBe(true);
  });

  it("blocks an operator edit that promises an unsourced incentive", () => {
    expect(() =>
      assertGroundedWinBackMessage("Come back for 20% off your next order")
    ).toThrow(/no promotion is configured/);
    expect(() =>
      assertGroundedWinBackMessage("We can give you $10 off and free pickup")
    ).toThrow(/no promotion is configured/);
    expect(() =>
      assertGroundedWinBackMessage(
        "Feel free to reply if you would like help scheduling a pickup."
      )
    ).not.toThrow();
  });
});
