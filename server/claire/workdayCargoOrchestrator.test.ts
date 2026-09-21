import { describe, expect, it } from "vitest";
import { cargoFieldsForUnknownIdentity } from "./workdayCargoOrchestrator";
import { UNKNOWN_CARGO_IDENTITY } from "../../shared/claireWorkdayCommand";

describe("unknown field cargo truthfulness", () => {
  it("never invents a customer name or order id", () => {
    const fields = cargoFieldsForUnknownIdentity({
      transcript: "I have another Century Park East dry-cleaning order in the car, but I can't remember the tenant's name",
      place: "Century Park East",
    });
    expect(fields.customerDisplayName).toBe(UNKNOWN_CARGO_IDENTITY);
    expect(fields.serviceType).toBe("dry_cleaning");
    expect(fields.location).toBe("Century Park East");
    expect(JSON.stringify(fields)).not.toMatch(/Sophia|orderId/);
  });
});
