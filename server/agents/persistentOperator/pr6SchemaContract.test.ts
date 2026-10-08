import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEARNING_KINDS, DELTA_TYPES } from "./learningStore";

function repoFile(relativePath: string): string {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), "utf8");
}

describe("Persistent Growth Operator PR6 schema, learning, and proof contracts (Slices J + K + L)", () => {
  it("lands learned delta schema through migration, schema, and boot paths", () => {
    const sql = repoFile("drizzle/0107_persistent_growth_learning_proof_hardening.sql");
    const schema = repoFile("drizzle/schema.ts");
    const migrate = repoFile("scripts/migrate.mjs");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `goal_cycle_learned_deltas`");
    expect(sql).toContain("uq_goal_cycle_learned_deltas_idempotency");

    for (const source of [sql, schema, migrate]) {
      expect(source).toContain("goal_cycle_learned_deltas");
      expect(source).toContain("outcomeId");
      expect(source).toContain("decisionId");
      expect(source).toContain("objectiveId");
      expect(source).toContain("canonicalOperatorId");
      expect(source).toContain("learningKind");
      expect(source).toContain("targetKey");
      expect(source).toContain("deltaType");
      expect(source).toContain("beforeStateJson");
      expect(source).toContain("afterStateJson");
      expect(source).toContain("evidenceReference");
    }
  });

  it("enforces learning idempotency unique key on (tenantId, outcomeId, learningKind, targetKey)", () => {
    const sql = repoFile("drizzle/0107_persistent_growth_learning_proof_hardening.sql");
    const schema = repoFile("drizzle/schema.ts");
    const migrate = repoFile("scripts/migrate.mjs");

    expect(sql).toContain("UNIQUE KEY `uq_goal_cycle_learned_deltas_idempotency` (`tenantId`, `outcomeId`, `learningKind`, `targetKey`)");
    expect(schema).toContain("uq_goal_cycle_learned_deltas_idempotency");
    expect(migrate).toContain("uq_goal_cycle_learned_deltas_idempotency");
  });

  it("distinguishes structured learning kinds and delta types", () => {
    expect(LEARNING_KINDS).toContain("doctrine_weight");
    expect(LEARNING_KINDS).toContain("loadout_recommendation");
    expect(LEARNING_KINDS).toContain("channel_affinity");
    expect(LEARNING_KINDS).toContain("execution_constraint");

    expect(DELTA_TYPES).toContain("boost");
    expect(DELTA_TYPES).toContain("suppress");
    expect(DELTA_TYPES).toContain("reinforce");
    expect(DELTA_TYPES).toContain("constraint");
  });

  it("keeps learning evaluation and proof read models model-free and receipt-backed", () => {
    const learningStore = repoFile("server/agents/persistentOperator/learningStore.ts");
    const proofReadModels = repoFile("server/agents/persistentOperator/proofReadModels.ts");

    expect(learningStore).not.toContain("invokeLLM");
    expect(learningStore).not.toContain("anthropic");
    expect(learningStore).not.toContain("openai");

    expect(proofReadModels).not.toContain("invokeLLM");
    expect(proofReadModels).not.toContain("anthropic");
    expect(proofReadModels).not.toContain("openai");
  });

  it("ensures proof/read models are non-mutating observational projections", () => {
    const proofReadModels = repoFile("server/agents/persistentOperator/proofReadModels.ts");

    expect(proofReadModels).not.toContain(".insert(");
    expect(proofReadModels).not.toContain(".update(");
    expect(proofReadModels).not.toContain(".delete(");
  });
});
