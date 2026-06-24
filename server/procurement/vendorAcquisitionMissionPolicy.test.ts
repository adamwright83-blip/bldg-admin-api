import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MISSION_OUTREACH_MODES,
  MISSION_STATUSES,
  canActivateMission,
  canCancelMission,
  canCompleteMission,
  canCreateMission,
  isRegisteredMissionStatus,
  isRegisteredOutreachMode,
  missionAllowsAutoSend,
  missionHasAtLeastOneQualityGate,
  type VendorAcquisitionMissionDefinition,
} from "./vendorAcquisitionMissionPolicy";

const definition = (
  patch: Partial<VendorAcquisitionMissionDefinition> = {},
): VendorAcquisitionMissionDefinition => ({
  category: "dog_walking",
  geographyLabel: "Hollywood / Silver Lake",
  targetQuantity: 10,
  qualityGates: { minGoogleRating: 4.8, minYelpRating: 4.2 },
  outreachMode: "draft_only",
  deadlineAt: new Date("2099-01-01T00:00:00.000Z"),
  ...patch,
});

describe("vendor acquisition mission contract (Slice 70)", () => {
  it("defines exactly the registered outreach modes and statuses", () => {
    expect(MISSION_OUTREACH_MODES).toEqual(["draft_only", "supervised_send", "auto_send"]);
    expect(MISSION_STATUSES).toEqual(["draft", "active", "completed", "cancelled"]);
  });

  it("never declares auto-send allowed, regardless of input", () => {
    expect(missionAllowsAutoSend()).toBe(false);
  });

  it("requires at least one real quality gate before a mission can be created", () => {
    expect(missionHasAtLeastOneQualityGate({})).toBe(false);
    expect(missionHasAtLeastOneQualityGate({ minGoogleRating: 4.8 })).toBe(true);
    expect(missionHasAtLeastOneQualityGate({ requireVerifiedContact: true })).toBe(true);
  });

  it("creates a valid draft_only mission with no reasons", () => {
    const decision = canCreateMission(definition());
    expect(decision).toEqual({ allowed: true, reasons: [] });
  });

  it("rejects missing category, geography, or quality gate", () => {
    expect(canCreateMission(definition({ category: "" })).reasons).toContain("missing_category");
    expect(canCreateMission(definition({ geographyLabel: "  " })).reasons).toContain(
      "missing_geography_label",
    );
    expect(canCreateMission(definition({ qualityGates: {} })).reasons).toContain(
      "missing_quality_gate",
    );
  });

  it("rejects a non-positive or fractional target quantity", () => {
    expect(canCreateMission(definition({ targetQuantity: 0 })).reasons).toContain(
      "invalid_target_quantity",
    );
    expect(canCreateMission(definition({ targetQuantity: -3 })).reasons).toContain(
      "invalid_target_quantity",
    );
    expect(canCreateMission(definition({ targetQuantity: 2.5 })).reasons).toContain(
      "invalid_target_quantity",
    );
  });

  it("rejects an unregistered outreach mode", () => {
    expect(canCreateMission(definition({ outreachMode: "cold_call" })).reasons).toContain(
      "outreach_mode_not_registered",
    );
  });

  it("always rejects auto_send at creation, even though it is a registered mode name", () => {
    expect(isRegisteredOutreachMode("auto_send")).toBe(true);
    const decision = canCreateMission(definition({ outreachMode: "auto_send" }));
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("auto_send_not_yet_enabled");
  });

  it("allows supervised_send at creation", () => {
    expect(canCreateMission(definition({ outreachMode: "supervised_send" })).allowed).toBe(true);
  });

  it("rejects a deadline that is not in the future", () => {
    const now = new Date("2026-06-24T00:00:00.000Z");
    expect(
      canCreateMission(definition({ deadlineAt: new Date("2026-06-23T00:00:00.000Z") }), now)
        .reasons,
    ).toContain("deadline_not_in_future");
    expect(
      canCreateMission(definition({ deadlineAt: new Date("2026-06-25T00:00:00.000Z") }), now)
        .allowed,
    ).toBe(true);
  });

  it("allows a mission with no deadline at all", () => {
    expect(canCreateMission(definition({ deadlineAt: null })).allowed).toBe(true);
  });

  it("only activates a mission that is currently in draft status", () => {
    expect(canActivateMission("draft").allowed).toBe(true);
    expect(canActivateMission("active").reasons).toContain("mission_not_in_draft_status");
    expect(canActivateMission("completed").reasons).toContain("mission_not_in_draft_status");
    expect(canActivateMission("not_a_real_status").reasons).toContain(
      "mission_status_not_registered",
    );
  });

  it("only completes a mission that is currently active", () => {
    expect(canCompleteMission("active").allowed).toBe(true);
    expect(canCompleteMission("draft").reasons).toContain("mission_not_active");
  });

  it("blocks cancelling a mission that is already terminal", () => {
    expect(canCancelMission("draft").allowed).toBe(true);
    expect(canCancelMission("active").allowed).toBe(true);
    expect(canCancelMission("completed").reasons).toContain("mission_already_terminal");
    expect(canCancelMission("cancelled").reasons).toContain("mission_already_terminal");
  });

  it("recognizes the exact registered status set", () => {
    for (const status of MISSION_STATUSES) expect(isRegisteredMissionStatus(status)).toBe(true);
    expect(isRegisteredMissionStatus("archived")).toBe(false);
  });
});

describe("vendor acquisition mission migration isolation (Slice 70)", () => {
  it("creates exactly one new table with no live source connector or outreach activation", () => {
    const sql = fs.readFileSync(
      "procurement/migrations/0018_vendor_acquisition_missions.sql",
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `vendor_acquisition_missions`");
    expect(sql).not.toMatch(/ALTER TABLE/i);
    expect(sql).not.toMatch(/\bfetch\(/);
    expect(sql).not.toMatch(/\baxios\b/);
    expect(sql).not.toMatch(/REFERENCES/i);
    expect(sql).toContain("'draft_only'");
    expect(sql).toContain("'auto_send'");
  });
});
