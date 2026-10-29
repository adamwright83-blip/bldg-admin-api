import { describe, expect, it } from "vitest";
import { asViews, exampleReading } from "../../../../server/firstTenMinutes/testSupport/exampleReading";
import { findingLine } from "./FindingsSheet";

describe("what the crew found, one plain line each (Nina)", () => {
  it("says each finding in the person's own terms and adds nothing", async () => {
    const { all, opportunities } = await exampleReading();
    const lines = asViews([...all, ...opportunities]).map(finding => findingLine(finding.payload));
    expect(lines).toContain("Your rule: No more Sunday deliveries.");
    expect(lines).toContain("Elena Ruiz asked in April, before you offered weekly Friday delivery. You offer it now.");
    expect(lines).toContain("You tend to finish with a real question: “Would Friday suit?” “Shall I bring two?”");
    expect(lines).toContain("Friday delivery: Café Lumen, Juniper Yoga, Mercer");
  });
});
