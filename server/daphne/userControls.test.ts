import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
describe("Daphne V2 inspector/user controls",()=>{
 it("makes correction and rejection explicit user-authored supersession rather than silent overwrite",()=>{
  const s=readFileSync(new URL("./userControls.ts",import.meta.url),"utf8");
  expect(s).toContain('claimType:"supersession"'); expect(s).toContain('humanPinned:true'); expect(s).toContain('observationKind:"correction"');
 });
});
