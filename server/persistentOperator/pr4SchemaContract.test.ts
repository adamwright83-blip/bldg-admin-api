import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function repoFile(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("Persistent Growth Operator PR4 schema and authority contracts", () => {
  it("lands decision and receipt lineage through migration, schema, and boot paths", () => {
    const sql = repoFile("drizzle/0105_persistent_growth_decisions_receipts.sql");
    const schema = repoFile("drizzle/schema.ts");
    const migrate = repoFile("scripts/migrate.mjs");

    expect(sql).toContain(
      "CREATE TABLE IF NOT EXISTS \`claire_proactive_obligations\`"
    );
    expect(sql).toContain("MODIFY COLUMN \`kind\` varchar(32) NOT NULL");
    expect(migrate).toContain("MODIFY COLUMN kind VARCHAR(32) NOT NULL");

    for (const source of [sql, schema, migrate]) {
      expect(source).toContain("goal_cycle_decisions");
      expect(source).toContain("decisionFingerprint");
      expect(source).toContain("candidateFingerprint");
      expect(source).toContain("sourceCoverageJson");
      expect(source).toContain("loadoutJson");
      expect(source).toContain("decisionId");
      expect(source).toContain("goalRunId");
      expect(source).toContain("cycleId");
      expect(source).toContain("operationStatus");
    }
  });

  it("keeps historical decisions append-only and model-free", () => {
    const store = repoFile("server/persistentOperator/decisionStore.ts");
    const engine = repoFile("server/persistentOperator/decisionEngine.ts");

    expect(store).toContain("appendGoalCycleDecision");
    expect(store).not.toContain(".update(goalCycleDecisions)");
    expect(engine).toContain("selectDeterministicCycleChoice");
    expect(engine).toContain("selectExecutionIntelligence");
    expect(engine).not.toContain("invokeLLM");
    expect(engine).not.toContain("anthropic");
  });

  it("fences replay lineage so an older cycle cannot replace a newer decision", () => {
    const engine = repoFile("server/persistentOperator/decisionEngine.ts");
    const obligations = repoFile("server/persistentOperator/obligationStore.ts");

    expect(engine).toContain("onlyIfUnclaimedOrSameDecision: true");
    expect(obligations).toContain("onlyIfUnclaimedOrSameDecision?: boolean");
    expect(obligations).toContain("isNull(claireProactiveObligations.decisionId)");
    expect(obligations).toContain(
      "eq(claireProactiveObligations.decisionId, input.decisionId)"
    );
  });

  it("keeps missing receipt links explicitly unresolved", () => {
    const receipt = repoFile("server/persistentOperator/operationReceipt.ts");
    expect(receipt).toContain('status: "unresolved"');
    expect(receipt).toContain("no_authority_event_linked");
    expect(receipt).toContain("no_execution_event_linked");
    expect(receipt).toContain("business_outcome_not_linked");
    expect(receipt).toContain("economic_observation_not_linked");
  });
});
