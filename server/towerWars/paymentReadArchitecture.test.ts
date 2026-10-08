import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("keeps real Tower Wars revenue behind canonical admitted economics", () => {
 const source=readFileSync(new URL("./towerWarsService.ts",import.meta.url),"utf8");
 expect(source).toContain("loadPaidOrderLedger");
 expect(source).not.toMatch(/\.from\((orders|cleancloudPaidOrders)\)/);
 expect(source).not.toContain("Number(order.total");
 expect(source).toContain("authorityReceiptId");
});
