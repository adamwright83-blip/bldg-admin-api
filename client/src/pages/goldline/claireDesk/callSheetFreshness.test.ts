import { describe, expect, it } from "vitest";
import { callSheetWithheldCopy } from "./callSheetFreshness";

describe("call sheet freshness copy", () => {
  it("does not replace a prepared sheet", () => {
    expect(
      callSheetWithheldCopy({
        area: "Silver Lake",
        emptyMeansNoLapsedCustomers: false,
        lapsedCount: 2,
        withheldReason: null,
        contacts: [{}],
      })
    ).toBeNull();
  });

  it("says a current empty book has no lapsed customers", () => {
    expect(
      callSheetWithheldCopy({
        area: "Silver Lake",
        emptyMeansNoLapsedCustomers: true,
        lapsedCount: 0,
        withheldReason: null,
        contacts: [],
      })
    ).toEqual({
      heading: "No lapsed Silver Lake customers",
      body: "The current book has no lapsed customers in this area.",
    });
  });

  it("shows the withhold reason instead of zero customers", () => {
    const copy = callSheetWithheldCopy({
      area: "Silver Lake",
      emptyMeansNoLapsedCustomers: false,
      lapsedCount: null,
      withheldReason: "CleanCloud customer truth is import_failed. Personalized outreach is withheld until the book is current.",
      contacts: [],
    });
    expect(copy?.heading).toBe("Call sheet withheld");
    expect(copy?.body).toMatch(/import_failed/);
    expect(copy?.body).not.toMatch(/\b0\b/);
  });
});
