import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { formatVerifiedDelta, selectTheCurrent } from "./economicReaction";

const gain = {
  eventType: "economic.mom_revenue_gain_verified",
  deltaCents: 113630,
  periodFrom: "2026-09-01",
  periodTo: "2026-09-30",
};
const reconciled = {
  status: "reconciled",
  rangeFrom: "2026-09-01",
  rangeTo: "2026-09-30",
};

describe("selectTheCurrent", () => {
  it("selects the authored reaction and copies the verified delta", () => {
    expect(selectTheCurrent({ event: gain, reconciliation: reconciled })).toEqual({
      reactionId: "the_current",
      deltaCents: 113630,
    });
    expect(formatVerifiedDelta(113630)).toBe("+$1,136.30 VS LAST MONTH");
    expect(formatVerifiedDelta(14222)).toBe("+$142.22 VS LAST MONTH");
  });

  it("stays dark on a mismatch, a drop, or a gain for a different period", () => {
    expect(
      selectTheCurrent({
        event: gain,
        reconciliation: { ...reconciled, status: "mismatch" },
      })
    ).toBeNull();
    expect(
      selectTheCurrent({
        event: gain,
        reconciliation: { ...reconciled, status: "insufficient_evidence" },
      })
    ).toBeNull();
    expect(
      selectTheCurrent({
        event: { ...gain, eventType: "economic.revenue_drop_verified", deltaCents: -10 },
        reconciliation: reconciled,
      })
    ).toBeNull();
    expect(
      selectTheCurrent({
        event: gain,
        reconciliation: { ...reconciled, rangeFrom: "2026-08-01", rangeTo: "2026-08-31" },
      })
    ).toBeNull();
    expect(selectTheCurrent({ event: null, reconciliation: reconciled })).toBeNull();
  });

  it("the city overlay does not carry a baked-in dollar amount", () => {
    const overlay = readFileSync(
      new URL(
        "../client/src/components/admin/control-room/LanternCitySceneV6/TheCurrent.tsx",
        import.meta.url
      ),
      "utf8"
    );
    expect(overlay).toContain("formatVerifiedDelta(reaction.deltaCents)");
    expect(overlay).not.toMatch(/\$\d/);
    expect(overlay).toContain("if (!reaction) return null");
  });
});
