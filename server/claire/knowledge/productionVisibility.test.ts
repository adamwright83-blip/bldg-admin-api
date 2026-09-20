import { describe, expect, it } from "vitest";
import {
  hasNonProductionProvenance,
  isProductionVisibleBusinessRecord,
} from "./productionVisibility";

describe("Claire production business visibility", () => {
  it.each([
    { createdBy: "slice0-acceptance" },
    { requestId: "qa-only-followup-1" },
    { missionCode: "CODEX-E2E-6" },
    { accountName: "SAFE TO ARCHIVE fixture" },
    { note: "Synthetic verification follow-up" },
  ])("quarantines explicit non-production provenance %#", record => {
    expect(hasNonProductionProvenance(record)).toBe(true);
    expect(isProductionVisibleBusinessRecord(record)).toBe(false);
  });

  it("keeps ordinary production follow-ups visible", () => {
    expect(
      isProductionVisibleBusinessRecord({
        createdBy: "adam-admin",
        requestId: "8a6b2dc5-3dc4-4d60-a710-15287d9472f8",
        missionCode: "LOUISE-01",
        accountName: "The Louise",
        note: "Call Dana Tuesday",
      })
    ).toBe(true);
  });
});
