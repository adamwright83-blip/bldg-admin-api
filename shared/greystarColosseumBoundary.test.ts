import { describe, expect, it } from "vitest";
import { DAY1_TARGETS } from "./day1TenDoors";

/**
 * Slice 2 §2.1 — the five/ten boundary regression guard.
 *
 * `day1TenDoors` owns TEN real targets, SEVEN of them Greystar. The
 * Colosseum campaign's five-target lead hunt (shared/leadHunt.ts via
 * client/src/pages/goldline/colosseumCampaign.ts) is a projection over five
 * of those seven — it does not own the ten-target list.
 *
 * This test fails if either number moves, on purpose: narrowing
 * DAY1_TARGETS to five would delete five real sourced businesses, and
 * widening the five-target lead hunt would promote a real target into the
 * Colosseum campaign to move a number. Both are forbidden — see
 * docs/goldline/campaigns/GREYSTAR_COLOSSEUM_SNAPSHOT.md.
 */
describe("Greystar / Colosseum five-versus-ten boundary", () => {
  it("day1TenDoors owns exactly ten real targets", () => {
    expect(DAY1_TARGETS.length).toBe(10);
  });

  it("exactly seven of the ten targets are Greystar", () => {
    expect(DAY1_TARGETS.filter(target => target.isGreystar).length).toBe(7);
  });

  it("the five Colosseum lead-hunt ids are a subset of the ten real targets", async () => {
    const { COLOSSEUM_LEAD_HUNT } = await import(
      "../client/src/pages/goldline/colosseumCampaign"
    );
    expect(COLOSSEUM_LEAD_HUNT.targetIds.length).toBe(5);
    const realIds = new Set(DAY1_TARGETS.map(target => target.id));
    for (const id of COLOSSEUM_LEAD_HUNT.targetIds) {
      expect(realIds.has(id), `${id} must be a real day1TenDoors target`).toBe(
        true
      );
    }
  });
});
