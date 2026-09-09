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
});
