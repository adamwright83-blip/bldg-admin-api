import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OBJECTIVE_STATUSES } from "./objectiveStore";
import { OUTCOME_IMPACT_CLASSES, EPISTEMIC_STATUSES } from "./outcomeStore";
import { GOLDLINE_TRUTH_LAWS } from "../../shared/goldlineTruthContract";

function repoFile(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("Persistent Growth Operator PR5 schema and truth contracts (Slices H + I)", () => {
  it("lands objective and outcome lineage through migration, schema, and boot paths", () => {
    const sql = repoFile("drizzle/0106_persistent_growth_objectives_outcomes.sql");
    const schema = repoFile("drizzle/schema.ts");
    const migrate = repoFile("scripts/migrate.mjs");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `goal_cycle_objectives`");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `goal_cycle_outcomes`");
    expect(sql).toContain("ALTER TABLE `agent_events`");
    expect(sql).toContain("ADD COLUMN `objectiveId`");

    for (const source of [sql, schema, migrate]) {
      expect(source).toContain("goal_cycle_objectives");
      expect(source).toContain("goal_cycle_outcomes");
      expect(source).toContain("objectiveId");
      expect(source).toContain("canonicalOperatorId");
      expect(source).toContain("decisionId");
      expect(source).toContain("evidenceReference");
      expect(source).toContain("evidenceClass");
      expect(source).toContain("outcomeKind");
      expect(source).toContain("impactClass");
      expect(source).toContain("epistemicStatus");
      expect(source).toContain("sourceSystem");
    }
  });

  it("enforces 1:1 decision idempotency and outcome idempotency keys", () => {
    const sql = repoFile("drizzle/0106_persistent_growth_objectives_outcomes.sql");
    const schema = repoFile("drizzle/schema.ts");

    expect(sql).toContain("uq_goal_cycle_objectives_decision");
    expect(sql).toContain("uq_goal_cycle_outcomes_idempotency");
    expect(schema).toContain("uq_goal_cycle_objectives_decision");
    expect(schema).toContain("uq_goal_cycle_outcomes_idempotency");
  });

  it("distinguishes complete objective lifecycle statuses", () => {
    expect(OBJECTIVE_STATUSES).toEqual([
      "presented",
      "accepted",
      "in_progress",
      "action_attempted",
      "action_executed",
      "completed",
      "failed",
      "blocked",
      "cancelled",
    ]);
  });

  it("distinguishes outcome impact classes and epistemic statuses", () => {
    expect(OUTCOME_IMPACT_CLASSES).toContain("action_verification");
    expect(OUTCOME_IMPACT_CLASSES).toContain("commercial_revenue");
    expect(OUTCOME_IMPACT_CLASSES).toContain("operational_result");
    expect(OUTCOME_IMPACT_CLASSES).toContain("customer_lifecycle");

    expect(EPISTEMIC_STATUSES).toContain("verified");
    expect(EPISTEMIC_STATUSES).toContain("unverified");
    expect(EPISTEMIC_STATUSES).toContain("disputed");
  });

  it("keeps objective materialization and outcome binding model-free and deterministic", () => {
    const objectiveStore = repoFile("server/persistentOperator/objectiveStore.ts");
    const outcomeStore = repoFile("server/persistentOperator/outcomeStore.ts");

    expect(objectiveStore).not.toContain("invokeLLM");
    expect(objectiveStore).not.toContain("anthropic");
    expect(objectiveStore).not.toContain("openai");
    expect(outcomeStore).not.toContain("invokeLLM");
    expect(outcomeStore).not.toContain("anthropic");
    expect(outcomeStore).not.toContain("openai");
  });

  it("fails closed on financial review for commercial truth", () => {
    const outcomeStore = repoFile("server/persistentOperator/outcomeStore.ts");
    expect(outcomeStore).toContain(
      "Financial review status fails closed for authoritative commercial revenue"
    );
  });

  it("adheres to Goldline truth laws: action is not outcome and game cannot write reality", () => {
    expect(GOLDLINE_TRUTH_LAWS.actionIsNotOutcome).toBe(
      "Effort, contact, outreach, gameplay, and attempted work do not imply success."
    );
    expect(GOLDLINE_TRUTH_LAWS.evidenceBeforeOutcome).toBe(
      "A business outcome requires authoritative external or operator-attested evidence."
    );
    expect(GOLDLINE_TRUTH_LAWS.gameCannotWriteReality).toBe(
      "Game projection may represent business truth but may never manufacture it."
    );
  });
});
