import { describe, expect, it } from "vitest";
import { inferCustomerCadence } from "@shared/lanternCity";
import { projectLanternPresentation } from "@shared/lanternPresentation";
import {
  deriveTransientLanternEvidence,
  hasVerifiedRecurringService,
  lanternAssetForCadence,
  transientLanternOverlay,
} from "./lanternCustomerPresentation";
import { LANTERN_CITY_V5_ASSETS } from "@/components/goldline/lanternCityV5Assets";

describe("lanternCustomerPresentation", () => {
  it("does not treat weekly cadence alone as hearth", () => {
    const cadence = inferCustomerCadence({
      qualifyingOrderDates: [
        "2026-01-01",
        "2026-01-08",
        "2026-01-15",
        "2026-01-22",
        "2026-01-29",
      ],
      today: "2026-02-05",
      sparseFallback: "active",
    });
    expect(projectLanternPresentation(cadence)).toBe("bright");
    expect(hasVerifiedRecurringService({ identityKey: "weekly-customer" }).verified).toBe(
      false
    );
    expect(lanternAssetForCadence(cadence, hasVerifiedRecurringService({ identityKey: "weekly-customer" }))).toBe(
      LANTERN_CITY_V5_ASSETS.lanterns.active
    );
  });

  it("uses hearth art only with verified recurring evidence", () => {
    const cadence = inferCustomerCadence({
      qualifyingOrderDates: ["2026-01-01"],
      today: "2026-02-05",
      sparseFallback: "active",
    });
    expect(
      lanternAssetForCadence(cadence, {
        verified: true,
        source: "standing_service_record",
      })
    ).toBe(LANTERN_CITY_V5_ASSETS.lanterns.hearth);
  });

  it("shows spark only after authoritative outreach evidence", () => {
    expect(
      transientLanternOverlay(
        deriveTransientLanternEvidence({
          physicalEntityId: "x",
          commercialState: "none",
          historyMarks: [],
          residentIntensity: 1,
          illumination: "dark",
          recoveryState: "attempted",
          epistemicState: "confirmed",
          attentionReasons: [],
          canonicalTowerAssetId: null,
        })
      )
    ).toBe(LANTERN_CITY_V5_ASSETS.lanterns.spark);
    expect(
      transientLanternOverlay({
        outreachSent: true,
        replyReceived: false,
        orderRestored: false,
      })
    ).toBe(LANTERN_CITY_V5_ASSETS.lanterns.spark);
  });

  it("does not show ember without reply evidence", () => {
    expect(
      transientLanternOverlay({
        outreachSent: true,
        replyReceived: false,
        orderRestored: false,
      })
    ).not.toBe(LANTERN_CITY_V5_ASSETS.lanterns.ember);
    expect(
      deriveTransientLanternEvidence({
        physicalEntityId: "x",
        commercialState: "none",
        historyMarks: [],
        residentIntensity: 1,
        illumination: "dark",
        recoveryState: "attempted",
        epistemicState: "confirmed",
        attentionReasons: [],
        canonicalTowerAssetId: null,
      }).replyReceived
    ).toBe(false);
  });

  it("shows restored burst only on recovered evidence", () => {
    expect(
      transientLanternOverlay(
        deriveTransientLanternEvidence({
          physicalEntityId: "x",
          commercialState: "none",
          historyMarks: [],
          residentIntensity: 1,
          illumination: "active",
          recoveryState: "recovered",
          epistemicState: "confirmed",
          attentionReasons: [],
          canonicalTowerAssetId: null,
        })
      )
    ).toBe(LANTERN_CITY_V5_ASSETS.lanterns.restored);
  });

  it("does not treat a tool click as restored evidence", () => {
    expect(
      transientLanternOverlay({
        outreachSent: true,
        replyReceived: false,
        orderRestored: false,
      })
    ).not.toBe(LANTERN_CITY_V5_ASSETS.lanterns.restored);
  });

  it("does not derive attempted/recovered from absent projection", () => {
    expect(deriveTransientLanternEvidence(null)).toEqual({
      outreachSent: false,
      replyReceived: false,
      orderRestored: false,
    });
    expect(
      deriveTransientLanternEvidence({
        physicalEntityId: "x",
        commercialState: "none",
        historyMarks: [],
        residentIntensity: 1,
        illumination: "dim",
        recoveryState: "none",
        epistemicState: "confirmed",
        attentionReasons: [],
        canonicalTowerAssetId: null,
      })
    ).toEqual({
      outreachSent: false,
      replyReceived: false,
      orderRestored: false,
    });
  });
});
