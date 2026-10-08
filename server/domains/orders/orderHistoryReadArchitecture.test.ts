import { readFileSync } from "node:fs";
import { it, expect } from "vitest";
it("keeps Orders customer-history selection in its owning read boundary", () => {
  const reader = readFileSync(
    new URL("./orderHistoryReadService.ts", import.meta.url),
    "utf8"
  );
  const consumer = readFileSync(
    new URL("../../geography/customerOrderTruth.ts", import.meta.url),
    "utf8"
  );
  expect(consumer).not.toContain(".from(orders)");
  expect(consumer).toContain("readNativeCustomerHistory(tenantId, db)");
  expect(reader).not.toMatch(/\.(insert|update|delete)\s*\(/);
  expect(reader).not.toMatch(/\?\?\s*["']default["']/);
});
