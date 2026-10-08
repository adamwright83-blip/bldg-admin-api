import { describe, expect, it } from "vitest";
import { ServerVerticalRegistry } from "../../strategy/verticalTemplates/registry";
import type { VerticalTemplate } from "../../strategy/verticalTemplates/types";
import { evaluateMacroGoalRunAndScheduleNext } from "./goalCycleService";
import {
  evaluateMacroGoalRun,
  observationSupportsCompletion,
  parseAuthoritativeMetricObservation,
  type MacroGoalRunPersistence,
} from "./macroGoalRuns";

const template: VerticalTemplate = {
  verticalKey: "fixture",
  displayName: "Fixture",
  metricCatalog: [{ metricKey: "accounts", authoritativeReaderId: "fixture.accounts.v1" }],
  opportunityKinds: [],
  campaignSeeds: [],
  obligationKinds: [],
  outcomeDefinitions: [],
  workFamilies: [],
  executionIntelligenceDoctrineFamilies: [],
  expectedSourceCapabilities: [],
  presentationDefaults: {},
};

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    tenantId: "tenant-1",
    canonicalOperatorId: "canonical:tenant-1:operator-1",
    operatorUserId: "operator-1",
    macroGoalId: "goal-1",
    verticalKey: "fixture",
    status: "active",
    goalSnapshotJson: { id: "goal-1" },
    metricKey: "accounts",
    targetValue: "10.00",
    unit: "accounts",
    baselineObservationRef: "baseline:1",
    baselineValue: "0.00",
    baselinePrecision: "exact",
    baselineCoverage: "complete",
    startedAt: new Date("2026-09-28T00:00:00.000Z"),
    lastEvaluatedAt: null,
    nextEvaluationAt: new Date("2026-09-28T01:00:00.000Z"),
    policyVersion: "test",
    completedAt: null,
    completionEvidenceRef: null,
    createdAt: new Date("2026-09-28T00:00:00.000Z"),
    updatedAt: new Date("2026-09-28T00:00:00.000Z"),
    ...overrides,
  } as any;
}

function persistence(initial = runRow()): MacroGoalRunPersistence {
  let row = initial;
  return {
    async createOrGet() {
      return row;
    },
    async get(input) {
      return input.tenantId === row.tenantId && input.id === row.id ? row : null;
    },
    async recordEvaluation(input) {
      if (input.tenantId !== row.tenantId || input.id !== row.id || row.status !== "active") {
        return row;
      }
      const evidence = input.completeWithEvidenceRef?.trim() || null;
      row = {
        ...row,
        status: evidence ? "completed" : row.status,
        lastEvaluatedAt: input.evaluatedAt,
        nextEvaluationAt: evidence ? null : input.nextEvaluationAt,
        completedAt: evidence ? input.evaluatedAt : row.completedAt,
        completionEvidenceRef: evidence ?? row.completionEvidenceRef,
      };
      return row;
    },
    async setStatus(input) {
      if (input.tenantId !== row.tenantId || input.id !== row.id) return null;
      const allowed =
        input.status === "active"
          ? row.status === "paused"
          : input.status === "paused"
            ? row.status === "active"
            : row.status === "active" || row.status === "paused";
      if (!allowed) return null;
      row = {
        ...row,
        status: input.status,
        nextEvaluationAt: input.status === "active" ? (input.nextEvaluationAt ?? new Date()) : null,
      };
      return row;
    },
  };
}

describe("macro goal runs", () => {
  it("keeps exact zero distinct from missing", () => {
    expect(parseAuthoritativeMetricObservation({
      value: 0,
      observationRef: "metric:zero",
      precision: "exact",
      coverage: "complete",
      observedAt: "2026-09-28T12:00:00.000Z",
    })).toMatchObject({ value: 0, precision: "exact", coverage: "complete" });

    expect(parseAuthoritativeMetricObservation({
      value: null,
      observationRef: null,
      precision: "missing",
      coverage: "unavailable",
      observedAt: "2026-09-28T12:00:00.000Z",
    })).toMatchObject({ value: null, precision: "missing", coverage: "unavailable" });
  });

  it("requires exact complete evidence before completion", () => {
    const base = {
      value: 10,
      observationRef: "metric:10",
      observedAt: "2026-09-28T12:00:00.000Z",
    } as const;
    expect(observationSupportsCompletion({
      targetValue: 10,
      observation: { ...base, precision: "exact", coverage: "complete" },
    })).toBe(true);
    expect(observationSupportsCompletion({
      targetValue: 10,
      observation: { ...base, precision: "recorded_only", coverage: "complete" },
    })).toBe(false);
    expect(observationSupportsCompletion({
      targetValue: 10,
      observation: { ...base, precision: "exact", coverage: "stale" },
    })).toBe(false);
    expect(observationSupportsCompletion({
      targetValue: 10,
      observation: { ...base, observationRef: null, precision: "exact", coverage: "complete" },
    })).toBe(false);
  });

  it("resolves the run metric through VerticalRegistry and records evidence-backed completion", async () => {
    const registry = new ServerVerticalRegistry();
    registry.registerTemplate(template);
    registry.registerMetricReader("fixture.accounts.v1", async ({ tenantId }) => ({
      value: tenantId === "tenant-1" ? 12 : 0,
      observationRef: "fixture:accounts:12",
      precision: "exact",
      coverage: "complete",
      observedAt: "2026-09-28T12:00:00.000Z",
    }));
    const result = await evaluateMacroGoalRun({
      tenantId: "tenant-1",
      runId: "run-1",
      registry,
      persistence: persistence(),
      now: new Date("2026-09-28T12:00:00.000Z"),
    });
    expect(result.completed).toBe(true);
    expect(result.run).toMatchObject({
      status: "completed",
      completionEvidenceRef: "fixture:accounts:12",
    });
  });

  it("refuses to reopen a terminal run through the status persistence contract", async () => {
    const completed = persistence(runRow({
      status: "completed",
      completedAt: new Date("2026-09-28T12:00:00.000Z"),
      completionEvidenceRef: "fixture:accounts:10",
    }));
    await expect(completed.setStatus({
      tenantId: "tenant-1",
      id: "run-1",
      status: "active",
      nextEvaluationAt: new Date("2026-09-28T13:00:00.000Z"),
    })).resolves.toBeNull();
    await expect(completed.setStatus({
      tenantId: "tenant-1",
      id: "run-1",
      status: "paused",
    })).resolves.toBeNull();
  });

  it("returns the next evaluation time for incomplete runs", async () => {
    const registry = new ServerVerticalRegistry();
    registry.registerTemplate(template);
    registry.registerMetricReader("fixture.accounts.v1", async () => ({
      value: 5,
      observationRef: "fixture:accounts:5",
      precision: "exact",
      coverage: "complete",
      observedAt: "2026-09-28T12:00:00.000Z",
    }));
    const result = await evaluateMacroGoalRunAndScheduleNext({
      tenantId: "tenant-1",
      runId: "run-1",
      registry,
      runPersistence: persistence(),
      now: new Date("2026-09-28T12:00:00.000Z"),
    });
    expect(result.completed).toBe(false);
    expect(result.run.nextEvaluationAt).toEqual(
      new Date("2026-09-28T13:00:00.000Z")
    );
  });

  it("returns no next evaluation after evidence-backed completion", async () => {
    const registry = new ServerVerticalRegistry();
    registry.registerTemplate(template);
    registry.registerMetricReader("fixture.accounts.v1", async () => ({
      value: 12,
      observationRef: "fixture:accounts:12",
      precision: "exact",
      coverage: "complete",
      observedAt: "2026-09-28T12:00:00.000Z",
    }));
    const result = await evaluateMacroGoalRunAndScheduleNext({
      tenantId: "tenant-1",
      runId: "run-1",
      registry,
      runPersistence: persistence(),
      now: new Date("2026-09-28T12:00:00.000Z"),
    });
    expect(result.completed).toBe(true);
    expect(result.run.nextEvaluationAt).toBeNull();
  });

  it("does not complete when coverage is partial even when the recorded number reaches target", async () => {
    const registry = new ServerVerticalRegistry();
    registry.registerTemplate(template);
    registry.registerMetricReader("fixture.accounts.v1", async () => ({
      value: 12,
      observationRef: "fixture:accounts:partial",
      precision: "recorded_only",
      coverage: "partial",
      observedAt: "2026-09-28T12:00:00.000Z",
    }));
    const result = await evaluateMacroGoalRun({
      tenantId: "tenant-1",
      runId: "run-1",
      registry,
      persistence: persistence(),
      now: new Date("2026-09-28T12:00:00.000Z"),
    });
    expect(result.completed).toBe(false);
    expect(result.run.status).toBe("active");
    expect(result.run.completionEvidenceRef).toBeNull();
  });
});
