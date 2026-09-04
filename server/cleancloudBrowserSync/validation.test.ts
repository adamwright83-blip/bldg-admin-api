import { describe, expect, it } from "vitest";
import { validatePayload, summarizeOrders, sourceDate } from "./validation";
const header =
  "Order ID,Placed,Customer,Customer ID,Address,Paid,Payment Date,Total";
const input = {
  storeId: "123",
  from: "2026-08-15",
  to: "2026-09-03",
  exportUrl:
    "https://cleancloudapp.com/include/data-export-endpoint.php?type=1&d1=15&m1=08&y1=2026&d2=03&m2=09&y2=2026&stores=[123]&group=",
  csv:
    header +
    "\n1,08/20/2026,Example,7,2170 Century Park East,Yes,09/02/2026,51.00",
};
describe("browser sync validation", () => {
  it("rejects impossible calendar dates and nonexistent DST wall times", () => {
    expect(sourceDate("02/30/2026")).toBeNull();
    expect(sourceDate("2026-03-08 02:30:00")).toBeNull();
    expect(sourceDate("09/02/2026 13:00 PM")).toBeNull();
    expect(sourceDate("02 Sep 2026 18:45")?.toISOString()).toBe(
      "2026-09-03T01:45:00.000Z"
    );
  });
  it("preserves payment date, cents and existing canonical building resolver", () => {
    const { normalized } = validatePayload(input, "example");
    expect(normalized[0].paymentDateUtc?.toISOString()).toBe(
      "2026-09-02T07:00:00.000Z"
    );
    expect(normalized[0].totalCents).toBe(5100);
    expect(summarizeOrders(normalized).byBuildingAndPaymentDate).toEqual([
      {
        building: "century_park_east",
        paymentDate: "2026-09-02",
        orders: 1,
        cents: 5100,
      },
    ]);
  });
  it("never treats unknown addresses as a known tower", () => {
    const { normalized } = validatePayload(
      {
        ...input,
        csv: input.csv.replace("2170 Century Park East", "Unknown address"),
      },
      "example"
    );
    expect(summarizeOrders(normalized).unresolved).toBe(1);
    expect(
      summarizeOrders(normalized).byBuildingAndPaymentDate[0].building
    ).toBe("unknown");
  });
  it("holds unpaid records without generating paid revenue", () => {
    const { normalized } = validatePayload(
      { ...input, csv: input.csv.replace("Yes,09/02/2026", "No,") },
      "example"
    );
    expect(summarizeOrders(normalized).paidCents).toBe(0);
  });
  it("rejects the entire report for invalid payment evidence, amounts or source store", () => {
    for (const csv of [
      input.csv.replace("Yes,09/02/2026", "Yes,"),
      input.csv.replace("51.00", "not-money"),
      input.csv.replace("Yes", "probably"),
    ])
      expect(() => validatePayload({ ...input, csv }, "example")).toThrow();
    expect(() =>
      validatePayload({ ...input, storeId: "456" }, "example")
    ).toThrow();
  });
  it("same payload has the same retry digest; corrections change it", () => {
    expect(validatePayload(input, "example").digest).toBe(
      validatePayload({ ...input }, "example").digest
    );
    expect(
      validatePayload(
        { ...input, csv: input.csv.replace("51.00", "52.00") },
        "example"
      ).digest
    ).not.toBe(validatePayload(input, "example").digest);
  });
});
