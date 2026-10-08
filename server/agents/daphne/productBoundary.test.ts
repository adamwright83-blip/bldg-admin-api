import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DAPHNE_PRODUCT_MANIFEST } from "./productBoundary";
describe("Daphne V2 standalone product boundary",()=>{
 it("does not depend on JOYSTICK agent or business domains",()=>{
  const s=readFileSync(new URL("./productBoundary.ts",import.meta.url),"utf8");
  for(const forbidden of ["../../claire/","../../mitch/","../../president/","../../orders/","../../commercial"]) expect(s).not.toContain(forbidden);
  expect(DAPHNE_PRODUCT_MANIFEST.productName).toBe("Daphne");
 });
});
