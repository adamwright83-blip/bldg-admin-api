import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
describe("native payment read authority architecture", () => {
  it("keeps customer/game paid truth behind owning Payment receipt admission", () => {
    const customer = source("../../geography/customerOrderTruth.ts");
    expect(customer).not.toContain("export function hasNativePaymentAuthority");
    expect(customer).toContain("readNativePaymentAuthorityReceipts(nativeRows)");
    expect(customer).toContain("hasNativePaymentAuthority(row, options?.paymentAuthorityReceipt)");
    const reader = source("./nativePaymentReadService.ts");
    expect(reader).toContain("paymentAuthorityReceiptMatches");
    expect(reader).not.toMatch(/\.(?:insert|update|delete)\s*\(/);
    expect(reader).not.toMatch(/\?\?\s*["']default["']/);
  });
  it("does not reintroduce the geography payment predicate into consumers", () => {
    for (const path of ["../../analytics/analyticsQueries.ts", "../../customerAssets/customerAssetProjection.ts", "../commercial/commercialPipelineService.ts"]) {
      expect(source(path)).not.toContain('from "../geography/customerOrderTruth"');
      expect(source(path)).toMatch(/from "\.\.(?:\/domains)?\/payment\/nativePaymentReadService"/);
    }
  });
});
