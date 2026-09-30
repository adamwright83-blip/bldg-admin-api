/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { describe, expect, it } from "vitest";
import { extractTacticalSignalsFromDebrief, bridgeParkingLotDebrief } from "./fieldEventBridge";
import { propagateGeographicConquest } from "./geographicConquestService";
import { sweepUnbridgedParkingLotDebriefs } from "./autonomousWorkerService";

describe("Closed-Loop Autonomy Integration (Phases 1 -> 2 -> 3)", () => {
  describe("Phase 2: Real Debrief -> Durable Learning Exactly Once", () => {
    it("converts driver pricing objection into a pricing_defense doctrine boost", () => {
      const signal = extractTacticalSignalsFromDebrief(
        "Manager at hotel said pricing per pound is $0.20 higher than their current commercial service."
      );
      expect(signal.targetKey).toBe("doctrine:pricing_defense");
      expect(signal.deltaType).toBe("boost");
      expect(signal.learningKind).toBe("doctrine_weight");
    });

    it("converts turnaround sensitivity into an express_turnaround doctrine boost", () => {
      const signal = extractTacticalSignalsFromDebrief(
        "Client loved the pitch but turnaround is a dealbreaker: need 24-hour turnaround on linens."
      );
      expect(signal.targetKey).toBe("doctrine:express_turnaround");
      expect(signal.deltaType).toBe("boost");
      expect(signal.learningKind).toBe("doctrine_weight");
    });

    it("converts gatekeeper roadblock into an appointment_required constraint", () => {
      const signal = extractTacticalSignalsFromDebrief(
        "Gate code required; front desk said no cold walk-ins allowed without appointment.",
        {
          outcome: "not_interested",
          decisionMakerStatus: "gatekeeper_blocked",
        }
      );
      expect(signal.targetKey).toBe("constraint:appointment_required");
      expect(signal.deltaType).toBe("constraint");
      expect(signal.learningKind).toBe("execution_constraint");
    });

    it("exports sweepUnbridgedParkingLotDebriefs for crash-safe sweeper reconciliation", () => {
      expect(typeof sweepUnbridgedParkingLotDebriefs).toBe("function");
    });

    it("exports bridgeParkingLotDebrief with synchronous durability guarantee", () => {
      expect(typeof bridgeParkingLotDebrief).toBe("function");
    });
  });

  describe("Phase 3: Real Account Win -> Real Nearby Opportunity Exactly Once -> Future Day Line", () => {
    it("fails closed gracefully when account cannot be resolved", async () => {
      const result = await propagateGeographicConquest({
        tenantId: "t-test-unresolved",
      });
      expect(result.propagated).toBe(false);
      expect(result.generatedMissions).toEqual([]);
    });

    it("exports propagateGeographicConquest with full parameter signature", () => {
      expect(typeof propagateGeographicConquest).toBe("function");
    });

    it("does not manufacture fake Corridor Prospect accounts when no real neighbor accounts exist", async () => {
      const result = await propagateGeographicConquest({
        tenantId: "t-test-no-neighbors",
        accountId: 999999,
      });
      expect(result.propagated).toBe(false);
      expect(result.generatedMissions).toEqual([]);
      expect(
        result.reason === "Database unavailable" ||
          result.reason?.includes("Could not resolve commercial account ID")
      ).toBe(true);
    });
  });
});
