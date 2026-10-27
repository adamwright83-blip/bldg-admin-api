import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { summarizeCustomerCsv } from "./customerImport";

const csv = [
  "Name,Address,City,State,Zip,Email",
  "Priya Natarajan,1200 Sunset Blvd,los angeles,ca,90026,priya@example.invalid",
  "Tom Delgado,88 Griffith Park Blvd,Los Angeles,CA,90039,tom@example.invalid",
  "Hannah Beck,4 Vermont Ave,Glendale,CA,91201,hannah@example.invalid",
  "Priya Natarajan,1200 Sunset Blvd,Los Angeles,CA,90026,priya@example.invalid",
  ",9 Nowhere St,Glendale,CA,91201,",
  "Lena Fischer,Back gate,,,,lena@example.invalid",
].join("\n");

describe("pre-account customer list summary", () => {
  it("counts rows, duplicates and rows needing review from the list alone", () => {
    const summary = summarizeCustomerCsv(csv);
    expect(summary.rows).toBe(6);
    expect(summary.duplicates).toBe(1);
    expect(summary.usable).toBe(3);
    expect(summary.needsReview).toBe(2);
  });

  it("takes localities only from the list's own city/state columns, normalised", () => {
    expect(summarizeCustomerCsv(csv).localities).toEqual([
      { label: "Los Angeles, CA", count: 2 },
      { label: "Glendale, CA", count: 1 },
    ]);
  });

  it("shows names only from the uploaded list, never invented ones", () => {
    expect(summarizeCustomerCsv(csv).sampleNames).toEqual([
      "Priya Natarajan",
      "Tom Delgado",
      "Hannah Beck",
      "Lena Fischer",
    ]);
  });

  it("falls back to postal codes when a list has no city column", () => {
    const summary = summarizeCustomerCsv("Name,Address,Zip\nAna Ruiz,10 Main St,90026\nBo Kim,11 Main St,90026");
    expect(summary.localities).toEqual([{ label: "90026", count: 2 }]);
  });

  it("the public endpoint checks draft credentials and stores nothing", () => {
    const router = readFileSync(new URL("./router.ts", import.meta.url), "utf8");
    const line = router.split("\n").find(l => l.includes("previewDraftCustomerList:"))!;
    expect(line).toContain("requireOnboardingSession(input)");
    expect(line).toContain('draft.status!=="draft"');
    expect(line).toContain("return summarizeCustomerCsv(input.payload)");
    expect(line).not.toMatch(/insert|update|runTenantImport|geocode/i);
  });
});
