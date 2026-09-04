import {describe,it,expect} from "vitest";
import {previewCustomerCsv} from "./customerImport";
describe("customer import preview",()=>{
 it("maps tolerant headers and quoted addresses",()=>{const [r]=previewCustomerCsv('Customer Name,Street Address,City,State,Email\nJane,"123 Main St, Unit 2",Atlanta,GA,jane@example.test');expect(r.unresolved).toBeNull();expect(r.address).toBe("123 Main St, Unit 2, Atlanta, GA");});
 it("deduplicates by stable identity across file and row order",()=>{const csv='Name,Address,Email\nJane,123 Main St,jane@example.test\nJane,123 Main St,jane@example.test';const rows=previewCustomerCsv(csv);expect(rows[1].duplicate).toBe(true);expect(previewCustomerCsv(csv)[0].externalId).toBe(rows[0].externalId);});
 it("leaves ambiguous and missing names unresolved",()=>{expect(previewCustomerCsv('Name,Address\nJane,Somewhere')[0].unresolved).toBeTruthy();expect(previewCustomerCsv('Name,Address\n,123 Main St')[0].unresolved).toBeTruthy();});
});
