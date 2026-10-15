import { describe, expect, it } from "vitest";
import { describeWinBackForBriefing } from "./showrunnerBriefing";
import type { WinBackDossier } from "../../strategy/winBackDossier";

const contact = {
  identityId: "id-1",
  name: "Ada",
  lastOrderDate: "2026-06-01",
  daysSinceLastOrder: 100,
  paidOrders: 3,
  lifetimeCents: 4500,
  medianGapDays: 21,
  lastOrderSummary: null,
  phone: "2135550100",
  email: null,
  smsConsent: "opted_in" as const,
  phoneOnFile: true,
  permissionSource: "desk",
  permissionCapturedAt: "2026-09-01T00:00:00.000Z",
  blocks: [],
};

describe("describeWinBackForBriefing", () => {
  it("does not turn a missing dossier into zero lapsed customers", () => {
    const facts = describeWinBackForBriefing(null);
    expect(facts.lapsedCustomers).toEqual([]);
    expect(facts.lapsedCount).toBeNull();
    expect(facts.emptyMeansNoLapsedCustomers).toBe(false);
    expect(facts.withheldReason).toMatch(/not an empty customer list/i);
  });

  it("keeps a failed import as a withhold, not a name list", () => {
    const dossier: WinBackDossier = {
      area: "Silver Lake",
      freshness: "import_failed",
      lapsedCount: null,
      emptyMeansNoLapsedCustomers: false,
      withheldReason: "CleanCloud customer truth is import_failed. Personalized outreach is withheld until the book is current.",
      contacts: [],
    };
    const facts = describeWinBackForBriefing(dossier);
    expect(facts.customerTruth).toBe("import_failed");
    expect(facts.lapsedCustomers).toEqual([]);
    expect(facts.withheldReason).toMatch(/import_failed/);
  });

  it("names only the contacts the dossier already cleared", () => {
    const dossier: WinBackDossier = {
      area: "Silver Lake",
      freshness: "current",
      lapsedCount: 1,
      emptyMeansNoLapsedCustomers: false,
      withheldReason: null,
      contacts: [contact],
    };
    const facts = describeWinBackForBriefing(dossier);
    expect(facts.lapsedCustomers).toEqual([
      {
        name: "Ada",
        lastOrderDate: "2026-06-01",
        paidOrders: 3,
        lifetimeDollars: 45,
        contactOnFile: true,
      },
    ]);
    expect(facts.emptyMeansNoLapsedCustomers).toBe(false);
  });
});
