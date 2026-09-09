import { describe, expect, it } from "vitest";
import {
  matchingCargoOrders,
  parseCargoTranscript,
} from "./goldlineCargoVoice";

describe("Goldline vehicle cargo voice", () => {
  it("creates a truthful unlinked Yazi proposal without fabricated identifiers", () => {
    const result = parseCargoTranscript(
      "Add Yazi’s two pair of pants to the dry cleaning vehicle."
    );
    expect(result).toEqual({
      customerDisplayName: "Yazi",
      itemDescription: "pairs of pants",
      quantity: 2,
      serviceType: "dry_cleaning",
      vehicleAction: "add",
      vehicleState: "IN_VEHICLE",
      processingState: "unknown",
      location: null,
      notes: null,
    });
    expect(result).not.toHaveProperty("customerId");
    expect(result).not.toHaveProperty("orderId");
  });

  it("recognizes removal but does not infer service or processing state", () => {
    expect(
      parseCargoTranscript("Remove Yazi’s pants from the vehicle.")
    ).toMatchObject({
      customerDisplayName: "Yazi",
      itemDescription: "pants",
      quantity: null,
      serviceType: null,
      processingState: "unknown",
      vehicleAction: "remove",
    });
  });

  it("only proposes a known order on an exact authoritative name match", () => {
    const orders = [
      { id: 1, firstName: "Rebecca", lastName: "Watson" },
      { id: 2, firstName: "Rebecca", lastName: "Jones" },
    ];
    const parsed = parseCargoTranscript(
      "I loaded Rebecca Watson’s laundry into the vehicle."
    );
    expect(parsed.customerDisplayName).toBe("Rebecca Watson");
    expect(matchingCargoOrders(parsed.customerDisplayName, orders)).toEqual([
      orders[0],
    ]);
    expect(matchingCargoOrders("Rebecca", orders)).toEqual([]);
  });

  it("preserves ambiguity instead of guessing between duplicate matches", () => {
    const duplicates = [
      { id: 1, firstName: "Rebecca", lastName: "Watson" },
      { id: 2, firstName: "Rebecca", lastName: "Watson" },
    ];
    expect(matchingCargoOrders("Rebecca Watson", duplicates)).toHaveLength(2);
  });

  it("records anonymous physical bags without fabricating a customer", () => {
    expect(
      parseCargoTranscript("These two Laundry Farm bags are in the Prius.")
    ).toMatchObject({
      customerDisplayName: "Unidentified Cargo",
      itemDescription: "Laundry Farm bags",
      quantity: 2,
      serviceType: null,
      vehicleAction: "add",
    });
  });
});
