import { describe, expect, it } from "vitest";
import type { PaidOrderEvent } from "../../analytics/paidOrderLedger";
import { observedChurnHistory } from "./observedChurnHistory";

function paid(orderNumber: string, cents: number, date: string): PaidOrderEvent {
  return {
    orderNumber,
    cents,
    businessDate: date.slice(0, 10),
    occurredAt: new Date(date),
    serviceType: "wash_fold",
    eventKey: `native:${orderNumber}`,
  } as PaidOrderEvent;
}

describe("proactive churn must use observed customer order histories", () => {
  it("uses actual paid amounts, dates and order identifiers", () => {
    const first = paid("123", 1850, "2026-05-01T09:00:00Z");
    const second = paid("125", 8250, "2026-06-15T09:00:00Z");
    const history = observedChurnHistory([second, first]);
    expect(history?.map(h => h.orderId)).toEqual([123, 125]);
    expect(history?.map(h => h.valueCents)).toEqual([1850, 8250]);
    expect(history?.map(h => new Date(h.serviceAt).toISOString())).toEqual([
      "2026-05-01T09:00:00.000Z", "2026-06-15T09:00:00.000Z",
    ]);
  });
  it("does not synthesize two orders from a single paid transaction", () => {
    expect(observedChurnHistory([paid("41", 5200, "2026-06-15T09:00:00Z")])).toBeNull();
  });
  it("abstains when order identity or service type is not provable", () => {
    const first=paid("41", 5200, "2026-05-01T09:00:00Z");
    const second=paid("42", 5000, "2026-06-15T09:00:00Z");
    expect(observedChurnHistory([first, { ...second, orderNumber: "ambiguous" }])).toBeNull();
    expect(observedChurnHistory([first, { ...second, serviceType: null }])).toBeNull();
    expect(observedChurnHistory([first, { ...second, orderNumber: "41" }])).toBeNull();
  });
  it("ignores non-paid refund rows instead of inventing another service", () => {
    const first=paid("41", 5200, "2026-05-01T09:00:00Z");
    const second=paid("42", 5000, "2026-06-15T09:00:00Z");
    const refund=paid("43", -1000, "2026-06-20T09:00:00Z");
    expect(observedChurnHistory([first, second, refund])).toHaveLength(2);
  });
});
