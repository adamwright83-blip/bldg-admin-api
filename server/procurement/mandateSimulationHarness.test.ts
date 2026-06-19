import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MANDATE_SIMULATION_SCENARIOS, simulateMandateScenario } from "./mandateSimulationHarness";

describe("mandate simulation harness", () => {
  it("provides deterministic, side-effect-free reports for every required scenario", () => {
    for (const scenario of MANDATE_SIMULATION_SCENARIOS) {
      const first = simulateMandateScenario(scenario);
      expect(simulateMandateScenario(scenario)).toEqual(first);
      expect(Object.values(first.sideEffects)).toEqual([false, false, false, false, false, false, false]);
    }
  });
  it("blocks impossible prerequisites", () => {
    expect(simulateMandateScenario("vendor_missing_agreement_blocks").finalStatus).toBe("blocked");
    expect(simulateMandateScenario("payment_required_blocks_when_not_authorized").finalStatus).toBe("blocked");
  });
  it("keeps unsupported work unsupported and blocked", () => {
    const report = simulateMandateScenario("mom_arrives_guest_readiness_with_budget", { unsupported: true });
    expect(report.stages[0]?.status).toBe("unsupported");
    expect(report.finalStatus).toBe("blocked");
  });
  it("does not equate gate approval or dispatch review with completion", () => {
    const report = simulateMandateScenario("high_risk_requires_operator_gate");
    expect(report.stages.find(stage => stage.stage === "execution_gate")?.status).toBe("gate_approved");
    expect(report.completed).toBe(false);
    expect(report.sideEffects.dispatched).toBe(false);
  });
  it("requires verified proof for completion", () => {
    expect(simulateMandateScenario("proof_missing_blocks_completion").completed).toBe(false);
    expect(simulateMandateScenario("mom_arrives_guest_readiness_with_budget").completed).toBe(true);
  });
  it("respects budget and carries allergy and access-window constraints", () => {
    const report = simulateMandateScenario("mom_arrives_guest_readiness_with_budget");
    expect(report.constraints.spendCents).toBeLessThanOrEqual(report.constraints.budgetCapCents);
    expect(report.constraints).toMatchObject({ dogAllergy: true,
      accessWindow: "2026-06-20T16:00:00Z/2026-06-20T18:00:00Z" });
  });
  it("contains no I/O, stores, routes, SQL, or action integrations", async () => {
    const source = await readFile(new URL("./mandateSimulationHarness.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\b(fetch|axios|execute|query|insert|update|delete)\s*\(/i);
    expect(source).not.toMatch(/Store\b|Router\b|stripe|twilio|sendgrid|nodemailer|openai|anthropic/i);
  });
});
