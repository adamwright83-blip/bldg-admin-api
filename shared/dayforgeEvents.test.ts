import { describe, expect, it } from "vitest";
import {
  DAYFORGE_PRODUCT_EVENT_NAMES,
  DAYFORGE_PRODUCT_EVENT_PROPERTY_KEYS,
  assertDayforgeProductEventProperties,
  isDayforgeProductEventName,
  sanitizeDayforgeProductEventProperties,
} from "./dayforgeEvents";

describe("DayForge product event contract", () => {
  it("keeps every locked funnel event in the typed catalog", () => {
    // Existing DayForge + Goldline product telemetry, plus the two Real
    // Workday continuity events that observe (never mutate) future pressure
    // presentation and legitimate growth-action opening.
    expect(DAYFORGE_PRODUCT_EVENT_NAMES).toHaveLength(77);
    expect(DAYFORGE_PRODUCT_EVENT_NAMES).toContain("territory_scan_started");
    expect(DAYFORGE_PRODUCT_EVENT_NAMES).toContain("mission_game_completed");
    expect(DAYFORGE_PRODUCT_EVENT_NAMES).toContain(
      "recovered_revenue_realized"
    );
    expect(DAYFORGE_PRODUCT_EVENT_NAMES).toContain("goldline_session_started");
    expect(DAYFORGE_PRODUCT_EVENT_NAMES).toContain("cold_call_target_started");
    expect(DAYFORGE_PRODUCT_EVENT_NAMES).toContain("verified_capture");
    expect(DAYFORGE_PRODUCT_EVENT_NAMES).toContain(
      "population_scene_presented"
    );
    expect(DAYFORGE_PRODUCT_EVENT_NAMES).toContain(
      "corridor_transition_started"
    );
    expect(DAYFORGE_PRODUCT_EVENT_NAMES).toContain(
      "corridor_transition_completed"
    );
    expect(DAYFORGE_PRODUCT_EVENT_NAMES).toContain("future_pressure_presented");
    expect(DAYFORGE_PRODUCT_EVENT_NAMES).toContain("growth_action_opened");
    expect(Object.keys(DAYFORGE_PRODUCT_EVENT_PROPERTY_KEYS).sort()).toEqual(
      [...DAYFORGE_PRODUCT_EVENT_NAMES].sort()
    );
  });

  it("redacts PII, arbitrary client properties, nested data, and invalid values", () => {
    expect(
      sanitizeDayforgeProductEventProperties("territory_results_loaded", {
        resultCount: 4,
        providerKey: "google_places",
        durationMs: 725,
        topScoreBand: "high",
        address: "123 Main St",
        email: "operator@example.com",
        accountName: "Westview Property Management",
        arbitraryClientProp: "do not forward",
        evidence: { source: "provider" },
        impossibleNumber: Number.POSITIVE_INFINITY,
      })
    ).toEqual({
      resultCount: 4,
      providerKey: "google_places",
      durationMs: 725,
      topScoreBand: "high",
    });
  });

  it("fails closed when strict validation sees unknown or sensitive keys", () => {
    expect(() =>
      assertDayforgeProductEventProperties("opportunity_opened", {
        rank: 1,
        scoreBand: "high",
        decisionMakerName: "Dana R.",
      })
    ).toThrow(/decisionMakerName/);

    expect(() =>
      assertDayforgeProductEventProperties("mission_game_completed", {
        attemptNumber: 1,
        durationMs: { forged: true },
      })
    ).toThrow(/durationMs/);
  });

  it("accepts only known event names", () => {
    expect(isDayforgeProductEventName("account_won")).toBe(true);
    expect(isDayforgeProductEventName("contact_exported")).toBe(false);
  });
});