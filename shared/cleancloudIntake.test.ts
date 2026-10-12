import { describe, it, expect } from "vitest";
import {
  validateIntakePlan,
  intakeFingerprintText,
  intakePlanSchema,
} from "./cleancloudIntake";
const catalog = [
  { id: "1", label: "Shirt", unit: "piece" as const, section: "Dry Cleaning" },
  { id: "2", label: "Laundry", unit: "lb" as const, section: "Laundry" },
];
describe("CleanCloud intake intent", () => {
  it("accepts exact garments and two decimal pounds", () => {
    expect(
      validateIntakePlan(
        {
          lines: [
            { productId: "1", quantity: 4 },
            { productId: "2", quantity: 12.25 },
          ],
        },
        catalog
      ).lines
    ).toHaveLength(2);
  });
  it("rejects fractional garments, unknown products and excess weight precision", () => {
    for (const line of [
      { productId: "1", quantity: 1.5 },
      { productId: "2", quantity: 12.251 },
      { productId: "3", quantity: 2 },
    ])
      expect(() => validateIntakePlan({ lines: [line] }, catalog)).toThrow();
  });
  it("rejects duplicate product intents", () =>
    expect(
      intakePlanSchema.safeParse({
        lines: [
          { productId: "1", quantity: 2 },
          { productId: "1", quantity: 3 },
        ],
      }).success
    ).toBe(false));
  it("fingerprints quantities in stable order and includes price and customer", () => {
    const base = {
      externalOrderId: "101",
      customerName: "Example",
      readyBy: "Tomorrow",
      priceListId: "default",
      totalCents: 3000,
      bags: 1,
      notes: "",
      tableText: "shirts",
      quantities: [
        { productId: "2", quantity: 12 },
        { productId: "1", quantity: 4 },
      ],
    };
    expect(intakeFingerprintText(base)).toBe(
      intakeFingerprintText({
        ...base,
        quantities: [...base.quantities].reverse(),
      })
    );
    expect(intakeFingerprintText(base)).not.toBe(
      intakeFingerprintText({ ...base, totalCents: 3001 })
    );
  });
});
