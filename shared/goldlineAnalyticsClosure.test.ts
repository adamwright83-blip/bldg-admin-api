import { describe, expect, it } from "vitest";
import {
  GOLDLINE_CLIENT_EVENT_NAMES,
  sanitizeDayforgeProductEventProperties,
} from "./dayforgeEvents";
describe("Goldline analytics closure", () => {
  it("allows privacy-safe target start", () => {
    expect(GOLDLINE_CLIENT_EVENT_NAMES).toContain("cold_call_target_started");
    expect(
      sanitizeDayforgeProductEventProperties("cold_call_target_started", {
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
