/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { describe, expect, it } from "vitest";
import {
  GOLDLINE_CLIENT_EVENT_NAMES,
  sanitizeLegacyDayforgeProductEventProperties,
} from "./legacyLegacyDayforgeEvents";
describe("Goldline analytics closure", () => {
  it("allows privacy-safe target start", () => {
    expect(GOLDLINE_CLIENT_EVENT_NAMES).toContain("cold_call_target_started");
    expect(
      sanitizeLegacyDayforgeProductEventProperties("cold_call_target_started", {
        sessionId: "s",
        phone: "secret",
      })
    ).toEqual({ sessionId: "s" });
  });
  it("cannot fabricate trusted outcomes", () => {
    for (const e of ["account_won", "visit_completed", "follow_up_created"])
      expect(GOLDLINE_CLIENT_EVENT_NAMES).not.toContain(e);
  });
});
