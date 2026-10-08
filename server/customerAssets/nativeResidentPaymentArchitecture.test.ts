import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
it("keeps Level 4 resident payment facts and browser inputs behind owning projections",()=>{
 const source=readFileSync(new URL("../level4Offensive.ts",import.meta.url),"utf8");
 expect(source).not.toContain("orders.total");expect(source).not.toContain("orders.paid");expect(source).toContain("readNativeResidentPaymentProjection");
 const reader=readFileSync(new URL("./nativeResidentPaymentProjection.ts",import.meta.url),"utf8");expect(reader).toContain("readNativeCustomerHistory");expect(reader).toContain("nativeCapturedAmountCents");expect(reader).not.toMatch(/\.(insert|update|delete)\s*\(/);
 const execution=readFileSync(new URL("../level4OffensiveExecute.ts",import.meta.url),"utf8");expect(execution).toContain("admitOffensiveActionSource");
});
