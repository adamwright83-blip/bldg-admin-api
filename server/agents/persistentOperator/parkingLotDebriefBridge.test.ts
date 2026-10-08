/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { describe, expect, it } from "vitest";
import { extractTacticalSignalsFromDebrief } from "./fieldEventBridge";

describe("ParkingLotDebriefTacticalExtraction", () => {
  it("detects pricing friction and recommends pricing_defense doctrine boost", () => {
    const signal = extractTacticalSignalsFromDebrief(
      "Customer said price is too high; competitor charges $1.10/lb and we are $1.50/lb."
    );
    expect(signal.targetKey).toBe("doctrine:pricing_defense");
    expect(signal.learningKind).toBe("doctrine_weight");
    expect(signal.deltaType).toBe("boost");
    expect(signal.confidence).toBe("high");
    expect(signal.explanation).toContain("pricing resistance");
  });

  it("detects turnaround friction and recommends express_turnaround doctrine boost", () => {
    const signal = extractTacticalSignalsFromDebrief(
      "They loved the samples, but turnaround is too slow. They need 24-hour delivery guaranteed."
    );
    expect(signal.targetKey).toBe("doctrine:express_turnaround");
    expect(signal.learningKind).toBe("doctrine_weight");
    expect(signal.deltaType).toBe("boost");
    expect(signal.confidence).toBe("high");
    expect(signal.explanation).toContain("turnaround sensitivity");
  });

  it("detects access constraints and enforces appointment_required constraint", () => {
    const signal = extractTacticalSignalsFromDebrief(
      "Gate code required; guard refused entry and said advance appointment is required for vendors.",
      {
        outcome: "not_interested",
        decisionMakerStatus: "gatekeeper_blocked",
      }
    );
    expect(signal.targetKey).toBe("constraint:appointment_required");
    expect(signal.learningKind).toBe("execution_constraint");
    expect(signal.deltaType).toBe("constraint");
    expect(signal.confidence).toBe("high");
    expect(signal.explanation).toContain("facility access restriction");
  });

  it("detects positive interest and reinforces field_first doctrine", () => {
    const signal = extractTacticalSignalsFromDebrief(
      "Manager was super excited, took our collateral, and requested a quote for their 40 units.",
      {
        outcome: "quote_requested",
        quoteRequested: true,
      }
    );
    expect(signal.targetKey).toBe("doctrine:field_first");
    expect(signal.learningKind).toBe("loadout_recommendation");
    expect(signal.deltaType).toBe("boost");
    expect(signal.confidence).toBe("high");
    expect(signal.explanation).toContain("quote/pilot interest observed");
  });

  it("handles general observations with field channel reinforcement", () => {
    const signal = extractTacticalSignalsFromDebrief(
      "Met the front desk staff, left brochures, seemed polite."
    );
    expect(signal.targetKey).toBe("doctrine:field_first");
    expect(signal.learningKind).toBe("channel_affinity");
    expect(signal.deltaType).toBe("reinforce");
    expect(signal.confidence).toBe("medium");
  });
});
