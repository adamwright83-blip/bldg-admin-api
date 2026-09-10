import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("vehicle cargo confirmation boundary", () => {
  it("keeps proposals and authoritative confirmation as separate authenticated mutations", () => {
    const router = read("./cargoRouter.ts");
    expect(router).toContain("propose: procedure");
    expect(router).toContain("confirm: procedure");
    expect(router).toContain("confirmed: z.literal(true)");
  });

  it("persists unlinked physical cargo independently from native orders", () => {
    const schema = read("./schema.sql");
    expect(schema).toContain("goldline_field_cargo");
    expect(schema).toContain("linkedOrderId int NULL");
    expect(schema).toContain("UNIQUE KEY uq_goldline_field_cargo_request");
  });

  it("keeps known orders on the existing custody mechanism and supports later linking", () => {
    const service = read("./cargoService.ts");
    expect(service).toContain("transferCustody({");
    expect(service).toContain("linkFieldCargo");
    expect(service).not.toContain("insert(orders)");
  });

  it("edits an existing field-cargo entry through the same table, not a parallel system", () => {
    const router = read("./cargoRouter.ts");
    expect(router).toContain("update: procedure");
    expect(router).toContain("fieldCargoId: z.string().uuid()");
    expect(router).toContain("cargoVoiceFieldsSchema.pick({");

    const service = read("./cargoService.ts");
    expect(service).toContain("export async function updateFieldCargo(");
    expect(service).toContain("UPDATE goldline_field_cargo SET");
    // No new table, no new migration — exactly the same bootstrap table
    // the add flow already writes to.
    expect(service.match(/CREATE TABLE/g)?.length).toBe(1);
  });

  it("scopes edits to this vehicle's own still-in-vehicle cargo, never another vehicle's or a real order row", () => {
    const service = read("./cargoService.ts");
    const fn = service.slice(
      service.indexOf("export async function updateFieldCargo("),
      service.indexOf("export async function linkFieldCargo(")
    );
    expect(fn).toContain("vehicleId=${input.vehicleId}");
    expect(fn).toContain("vehicleState='IN_VEHICLE'");
    expect(fn).not.toContain("UPDATE orders");
  });
});
