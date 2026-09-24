import {
  boolean,
  index,
  int,
  json,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** Candy Bar V0 — see drizzle/0097_candy_bar.sql. Not on production migrate path until Adam approves. */
export const candyBarWorkflows = mysqlTable(
  "candy_bar_workflows",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    operatorUserId: varchar("operatorUserId", { length: 128 }).notNull(),
    repository: varchar("repository", { length: 191 }).notNull(),
    currentGoal: text("currentGoal").notNull(),
    goalVersion: int("goalVersion").notNull().default(1),
    roadmapContext: text("roadmapContext"),
    protectedAreasJson: json("protectedAreasJson"),
    knownParallelWorkJson: json("knownParallelWorkJson"),
    nonGoalsJson: json("nonGoalsJson"),
    providerFallbackPolicyJson: json("providerFallbackPolicyJson").notNull(),
    autoPlanNext: boolean("autoPlanNext").notNull().default(false),
    preferredArchitect: varchar("preferredArchitect", { length: 32 }).notNull().default("anthropic"),
    preferredReviewer: varchar("preferredReviewer", { length: 32 }).notNull().default("xai_grok"),
    preferredEngineer: varchar("preferredEngineer", { length: 32 }).notNull().default("cursor"),
    maxStepsPerRun: int("maxStepsPerRun").notNull().default(40),
    maxRepairIterations: int("maxRepairIterations").notNull().default(3),
    maxReconcileRounds: int("maxReconcileRounds").notNull().default(2),
    maxWallClockMs: int("maxWallClockMs").notNull().default(21_600_000),
    maxProviderFailures: int("maxProviderFailures").notNull().default(5),
    budgetCents: int("budgetCents"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    ownerRepo: uniqueIndex("uq_candy_bar_workflow_owner_repo").on(
      table.tenantId,
      table.operatorUserId,
      table.repository
    ),
    tenantIdx: index("idx_candy_bar_workflow_tenant").on(table.tenantId, table.updatedAt),
  })
);

export const candyBarRuns = mysqlTable(
  "candy_bar_runs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    operatorUserId: varchar("operatorUserId", { length: 128 }).notNull(),
    workflowId: varchar("workflowId", { length: 36 }).notNull(),
    workflowType: varchar("workflowType", { length: 64 }).notNull().default("engineering_slice"),
    goalSnapshotJson: json("goalSnapshotJson").notNull(),
    state: varchar("state", { length: 32 }).notNull(),
    authorityLevel: varchar("authorityLevel", { length: 64 }),
    iteration: int("iteration").notNull().default(0),
    repairIteration: int("repairIteration").notNull().default(0),
    reconcileRound: int("reconcileRound").notNull().default(0),
    stepCount: int("stepCount").notNull().default(0),
    providerFailureCount: int("providerFailureCount").notNull().default(0),
    estimatedSpendCents: int("estimatedSpendCents"),
    spendKnown: boolean("spendKnown").notNull().default(false),
    currentStepId: varchar("currentStepId", { length: 36 }),
    parentRunId: varchar("parentRunId", { length: 36 }),
    repository: varchar("repository", { length: 191 }).notNull(),
    baseBranch: varchar("baseBranch", { length: 128 }).notNull().default("main"),
    baseSha: varchar("baseSha", { length: 64 }),
    plannedAgainstSha: varchar("plannedAgainstSha", { length: 64 }),
    candidateBranch: varchar("candidateBranch", { length: 191 }),
    candidatePrNumber: int("candidatePrNumber"),
    candidatePrUrl: varchar("candidatePrUrl", { length: 512 }),
    candidateHeadSha: varchar("candidateHeadSha", { length: 64 }),
    engineerSessionId: varchar("engineerSessionId", { length: 128 }),
    blocker: text("blocker"),
    humanGateReason: varchar("humanGateReason", { length: 64 }),
    mergeAttempted: boolean("mergeAttempted").notNull().default(false),
    deployAttempted: boolean("deployAttempted").notNull().default(false),
    productionMigrationAttempted: boolean("productionMigrationAttempted").notNull().default(false),
    nextPlanSpawned: boolean("nextPlanSpawned").notNull().default(false),
    leaseOwner: varchar("leaseOwner", { length: 128 }),
    leaseExpiresAt: timestamp("leaseExpiresAt"),
    nextRetryAt: timestamp("nextRetryAt"),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
  },
  table => ({
    tenantState: index("idx_candy_bar_runs_tenant_state").on(table.tenantId, table.state, table.updatedAt),
    operatorIdx: index("idx_candy_bar_runs_operator").on(
      table.tenantId,
      table.operatorUserId,
      table.createdAt
    ),
    leaseIdx: index("idx_candy_bar_runs_lease").on(table.state, table.leaseExpiresAt),
    workflowIdx: index("idx_candy_bar_runs_workflow").on(table.workflowId, table.createdAt),
  })
);

export const candyBarSteps = mysqlTable(
  "candy_bar_steps",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    runId: varchar("runId", { length: 36 }).notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    attemptNumber: int("attemptNumber").notNull().default(0),
    provider: varchar("provider", { length: 32 }),
    providerSessionId: varchar("providerSessionId", { length: 128 }),
    inputArtifactIdsJson: json("inputArtifactIdsJson"),
    outputArtifactIdsJson: json("outputArtifactIdsJson"),
    error: text("error"),
    blocker: text("blocker"),
    requiresHumanApproval: boolean("requiresHumanApproval").notNull().default(false),
    inputTokens: int("inputTokens"),
    outputTokens: int("outputTokens"),
    estimatedCostCents: int("estimatedCostCents"),
    costKnown: boolean("costKnown").notNull().default(false),
    leaseOwner: varchar("leaseOwner", { length: 128 }),
    leaseExpiresAt: timestamp("leaseExpiresAt"),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    idempotency: uniqueIndex("uq_candy_bar_step_idempotency").on(table.idempotencyKey),
    runIdx: index("idx_candy_bar_steps_run").on(table.runId, table.createdAt),
    leaseIdx: index("idx_candy_bar_steps_lease").on(table.status, table.leaseExpiresAt),
  })
);

export const candyBarArtifacts = mysqlTable(
  "candy_bar_artifacts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    runId: varchar("runId", { length: 36 }).notNull(),
    type: varchar("type", { length: 64 }).notNull(),
    schemaVersion: int("schemaVersion").notNull().default(1),
    producer: varchar("producer", { length: 128 }).notNull(),
    provider: varchar("provider", { length: 32 }).notNull(),
    contentJson: json("contentJson").notNull(),
    metadataJson: json("metadataJson"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  table => ({
    runType: index("idx_candy_bar_artifacts_run_type").on(table.runId, table.type, table.createdAt),
  })
);

export const candyBarApprovals = mysqlTable(
  "candy_bar_approvals",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    runId: varchar("runId", { length: 36 }).notNull(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    operatorUserId: varchar("operatorUserId", { length: 128 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    reason: text("reason"),
    actorUserId: varchar("actorUserId", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  table => ({
    runIdx: index("idx_candy_bar_approvals_run").on(table.runId, table.createdAt),
    tenantIdx: index("idx_candy_bar_approvals_tenant").on(
      table.tenantId,
      table.operatorUserId,
      table.createdAt
    ),
  })
);
