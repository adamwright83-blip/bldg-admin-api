import { describe, expect, it } from "vitest";
import { cargoSprite, visibleCargo, type VehicleCargoItem } from "./VehicleCargo";

const item = (id: number, state: VehicleCargoItem["state"]): VehicleCargoItem => ({
  id, state, appearance: state === "IN_VEHICLE_UNPROCESSED"
    ? { kind: "paper_bag", condition: "scrunched garments", next: "Processor handoff" }
    : { kind: "garment_bag", condition: "covered garments", next: "Customer return" },
});

describe("Vehicle Cargo home projection", () => {
  it("keeps an empty vehicle empty", () => expect(visibleCargo([])).toEqual({ visible: [], overflow: 0 }));
  it("uses deterministic paper bag art for unprocessed custody", () => {
    expect(cargoSprite(item(1, "IN_VEHICLE_UNPROCESSED"))).toContain("paper-bag-a");
    expect(cargoSprite(item(2, "IN_VEHICLE_UNPROCESSED"))).toContain("paper-bag-b");
  });
  it("uses finished art only for processed custody", () => expect(cargoSprite(item(3, "IN_VEHICLE_PROCESSED"))).toContain("processed-hanging"));
  it("exposes truthful overflow after four readable slots", () => {
    const result = visibleCargo([1, 2, 3, 4, 5, 6].map(id => item(id, "IN_VEHICLE_UNPROCESSED")));
    expect(result.visible.map(value => value.id)).toEqual([1, 2, 3, 4]);
    expect(result.overflow).toBe(2);
  });
});
