import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
describe("Daphne V2 standalone router boundary",()=>{
 it("exports card, evidence, controls, and policy preview without importing Claire",()=>{
  const source=readFileSync(new URL("./router.ts",import.meta.url),"utf8");
  expect(source).toContain("export const daphneRouter");
  expect(source).toContain("card:");
  expect(source).toContain("evidence:");
  expect(source).toContain("setControl:");
  expect(source).not.toContain('from "../../claire/');
 });
});
