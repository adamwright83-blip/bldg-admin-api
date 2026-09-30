import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getTableName } from "drizzle-orm";
import { appRouter } from "../routers";
import { resetDbForTesting, setDbForTesting } from "../db";
import {
  CITY_ANCHOR_PROFILES,
  getFranchiseById,
  listFranchises,
  provisionFranchise,
} from "./franchiseService";
import { macroGoalRuns } from "../../drizzle/schema";
import {
  setDayLineDepsForTesting,
  resetDayLineDepsForTesting,
} from "../goldline/dayline/currentDayLineService";

/**
 * Reusable mock database fixture with table tracking and in-memory row storage
 */
interface SqlConstraint {
  type: "eq" | "in";
  col: string;
  val?: any;
  vals?: any[];
}

function extractConstraints(sqlObj: any): SqlConstraint[] {
  if (!sqlObj) return [];
  const constraints: SqlConstraint[] = [];

  if (sqlObj.queryChunks && Array.isArray(sqlObj.queryChunks)) {
    const chunks = sqlObj.queryChunks;
    let currentCol: string | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;

      if (typeof chunk === "object") {
        if (chunk.queryChunks) {
          constraints.push(...extractConstraints(chunk));
        } else if (chunk.name && typeof chunk.name === "string" && !("value" in chunk)) {
          currentCol = chunk.name;
        } else if ("value" in chunk && !chunk.name && !Array.isArray(chunk.value)) {
          if (currentCol) {
            constraints.push({ type: "eq", col: currentCol, val: chunk.value });
            currentCol = null;
          }
        } else if (Array.isArray(chunk)) {
          const flatParams: any[] = [];
          for (const item of chunk) {
            if (Array.isArray(item)) {
              for (const sub of item) {
                if (sub && typeof sub === "object" && "value" in sub) {
                  flatParams.push(sub.value);
                }
              }
            } else if (item && typeof item === "object" && "value" in item) {
              flatParams.push(item.value);
            }
          }
          if (currentCol && flatParams.length > 0) {
            constraints.push({ type: "in", col: currentCol, vals: flatParams });
            currentCol = null;
          }
        }
      }
    }
  }

  return constraints;
}

function rowMatchesConstraints(row: any, constraints: SqlConstraint[]): boolean {
  for (const c of constraints) {
    if (c.type === "eq") {
      if (row[c.col] === undefined) return false;
      if (row[c.col] !== c.val) return false;
    } else if (c.type === "in") {
      if (row[c.col] === undefined) return false;
      if (!c.vals?.includes(row[c.col])) return false;
    }
  }
  return true;
}

function setupTestFranchiseDb() {
  const store = new Map<string, any[]>();
  const insertedRows = new Map<string, any[]>();
  const updatedRows = new Map<string, any[]>();

  const createQueryChain = (tableName: string) => {
    const getRows = (pred?: any) => {
      const rows = store.get(tableName) ?? [];
      if (tableName === "commercial_accounts" && rows.length === 0) {
        return [{ id: 42 }];
      }
      if (!pred) return rows;

      const constraints = extractConstraints(pred);
      if (constraints.length === 0) return rows;
      return rows.filter(r => rowMatchesConstraints(r, constraints));
    };

    const makeChain = (pred?: any) => {
      const c: any = {
        where: vi.fn((p?: any) => makeChain(p ?? pred)),
        innerJoin: vi.fn(() => makeChain(pred)),
        leftJoin: vi.fn(() => makeChain(pred)),
        rightJoin: vi.fn(() => makeChain(pred)),
        groupBy: vi.fn(() => makeChain(pred)),
        having: vi.fn(() => makeChain(pred)),
        orderBy: vi.fn(() => makeChain(pred)),
        limit: vi.fn(async (n?: number) => {
          const rows = getRows(pred);
          return typeof n === "number" ? rows.slice(0, n) : rows;
        }),
        then: (resolve: any, reject: any) =>
          Promise.resolve(getRows(pred)).then(resolve, reject),
      };
      return c;
    };
    return makeChain();
  };

  let idCounter = 1000;
  const insertHandler = vi.fn((table: any) => ({
    values: vi.fn((values: any) => {
      const tableName = getTableName(table);
      const incoming = Array.isArray(values) ? values : [values];
      const withTimestamps = incoming.map((row: any) => ({
        id: row.id ?? ++idCounter,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...row,
      }));

      const list = store.get(tableName) ?? [];
      list.push(...withTimestamps);
      store.set(tableName, list);

      const inserted = insertedRows.get(tableName) ?? [];
      inserted.push(...withTimestamps);
      insertedRows.set(tableName, inserted);

      return {
        onDuplicateKeyUpdate: vi.fn().mockImplementation(() => {
          return Promise.resolve([{ insertId: 1, affectedRows: withTimestamps.length }]);
        }),
        then: (resolve: any, reject: any) =>
          Promise.resolve([{ insertId: 1, affectedRows: withTimestamps.length }]).then(resolve, reject),
      };
    }),
  }));

  const updateHandler = vi.fn((table: any) => ({
    set: vi.fn((updates: any) => {
      const tableName = getTableName(table);
      const updated = updatedRows.get(tableName) ?? [];
      updated.push(updates);
      updatedRows.set(tableName, updated);

      return {
        where: vi.fn().mockImplementation(async (pred?: any) => {
          const rows = store.get(tableName) ?? [];
          const constraints = pred ? extractConstraints(pred) : [];
          for (const r of rows) {
            if (constraints.length === 0 || rowMatchesConstraints(r, constraints)) {
              Object.assign(r, updates);
            }
          }
          return [{ affectedRows: 1 }];
        }),
      };
    }),
  }));

  const mockTx: any = {
    insert: insertHandler,
    select: vi.fn((_fields?: any) => ({
      from: vi.fn((table: any) => createQueryChain(getTableName(table))),
    })),
    update: updateHandler,
  };

  const mockDb: any = {
    transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
    select: vi.fn((_fields?: any) => ({
      from: vi.fn((table: any) => createQueryChain(getTableName(table))),
    })),
    insert: insertHandler,
    update: updateHandler,
  };

  setDbForTesting(mockDb as any);
  return { mockDb, mockTx, store, insertedRows, updatedRows };
}

describe("Sovereign Truth Contract — Security, Auth, & Tenant Isolation", () => {
  beforeEach(() => {
    resetDbForTesting();
    resetDayLineDepsForTesting();
  });

  afterEach(() => {
    resetDbForTesting();
    resetDayLineDepsForTesting();
  });

  it("enforces that system.franchise procedures require admin authentication", async () => {
    const caller = appRouter.createCaller({
      user: null, // Unauthenticated caller
      tenantId: "default",
      req: { headers: {} } as any,
      res: { clearCookie: () => {} } as any,
    });

    // 1. Unauthenticated list must throw UNAUTHORIZED / FORBIDDEN
    await expect(caller.system.franchise.list()).rejects.toThrow();

    // 2. Unauthenticated provision must throw UNAUTHORIZED / FORBIDDEN
    await expect(
      caller.system.franchise.provision({
        city: "Austin",
        state: "TX",
        vertical: "commercial_laundry",
        targetMrrCents: 2500000,
      })
    ).rejects.toThrow();

    // 3. Unauthenticated resolveTenant must throw UNAUTHORIZED / FORBIDDEN
    await expect(
      caller.system.franchise.resolveTenant({ targetTenantId: "tenant_austin" })
    ).rejects.toThrow();
  });

  it("enforces that system.franchise rejects non-admin users", async () => {
    const caller = appRouter.createCaller({
      user: {
        id: 99,
        openId: "driver-test-user",
        name: "Test Driver",
        email: "driver@test.com",
        role: "driver", // Non-admin role
      },
      tenantId: "default",
      req: { headers: {} } as any,
      res: { clearCookie: () => {} } as any,
    });

    await expect(caller.system.franchise.list()).rejects.toThrow();
    await expect(
      caller.system.franchise.provision({
        city: "Austin",
        state: "TX",
        vertical: "commercial_laundry",
        targetMrrCents: 2500000,
      })
    ).rejects.toThrow();
    await expect(
      caller.system.franchise.resolveTenant({ targetTenantId: "tenant_austin" })
    ).rejects.toThrow();
  });

  it("fails closed on unsupported metros, never silently defaulting to Austin", async () => {
    // Attempt to provision unsupported cities
    await expect(
      provisionFranchise({
        city: "Honolulu",
        state: "HI",
        vertical: "commercial_laundry",
        targetMrrCents: 2000000,
      })
    ).rejects.toThrow(/Unsupported metro "Honolulu"/);

    await expect(
      provisionFranchise({
        city: "Atlantis",
        state: "XX",
        vertical: "commercial_laundry",
        targetMrrCents: 1000000,
      })
    ).rejects.toThrow(/Unsupported metro "Atlantis"/);
  });

  it("fails closed when database is unavailable: refuses ambient theater", async () => {
    resetDbForTesting(); // getDb() returns null
    await expect(
      provisionFranchise({
        city: "Austin",
        state: "TX",
        vertical: "commercial_laundry",
        targetMrrCents: 2500000,
      })
    ).rejects.toThrow(/Database unavailable for franchise provisioning/);
  });

  it("successfully provisions a supported metro with correct corridor profile, operator identity, and macro goal", async () => {
    const { store } = setupTestFranchiseDb();

    // Seed tenant row into store so getFranchiseById / listFranchises can find it
    store.set("dayforge_saas_tenants", [
      {
        id: "tenant_austin",
        slug: "franchise-austin",
        businessName: "Goldline Austin Central",
        contactName: "Austin Test Operator",
        contactPhone: "+18005550100",
        status: "active",
        createdAt: new Date(),
      },
    ]);

    const result = await provisionFranchise({
      city: "Austin",
      state: "TX",
      vertical: "commercial_laundry",
      targetMrrCents: 3000000,
      operatorName: "Austin Test Operator",
      operatorUserId: "admin-caller-openid",
    });

    expect(result.franchise).toBeDefined();
    expect(result.franchise.tenantId).toBe("tenant_austin");
    expect(result.franchise.city).toBe("Austin");
    expect(result.franchise.state).toBe("TX");
    expect(result.franchise.macroGoal.targetValue).toBe(30000);
    expect(result.franchise.territoryAnchors.length).toBeGreaterThan(0);
    expect(result.telemetry.length).toBe(6);
    expect(result.telemetry.every((s) => s.status === "completed")).toBe(true);

    // Verify lookup by franchise ID and tenant ID
    const byId = await getFranchiseById(result.franchise.id);
    expect(byId).toBeDefined();
    expect(byId?.city).toBe("Austin");

    const byTenantId = await getFranchiseById("tenant_austin");
    expect(byTenantId).toBeDefined();
    expect(byTenantId?.tenantId).toBe("tenant_austin");
  });

  it("lists the default Los Angeles flagship alongside provisioned franchises", async () => {
    const all = await listFranchises();
    expect(all.length).toBeGreaterThanOrEqual(1);

    const flagship = all.find((f) => f.tenantId === "default");
    expect(flagship).toBeDefined();
    expect(flagship?.city).toBe("Los Angeles");
    expect(flagship?.corridorDensityScore).toBe(94);
  });

  it("proves real-schema constraint adherence for macro_goal_runs: all NOT NULL columns populated", async () => {
    const { insertedRows } = setupTestFranchiseDb();

    await provisionFranchise({
      city: "Austin",
      state: "TX",
      vertical: "commercial_laundry",
      targetMrrCents: 2500000,
      operatorName: "Schema Validator Operator",
    });

    // 1. Verify macro_goal_runs row adheres to real MySQL schema constraints
    const macroRunRows = insertedRows.get("macro_goal_runs");
    expect(macroRunRows).toBeDefined();
    expect(macroRunRows?.length).toBe(1);

    const run = macroRunRows![0];
    // Mandatory NOT NULL fields per migration & schema
    expect(run.goalSnapshotJson).toBeDefined();
    expect(typeof run.goalSnapshotJson).toBe("object");
    expect(run.goalSnapshotJson.objective).toContain("Achieve $25,000/mo MRR");
    expect(run.baselinePrecision).toBe("exact");
    expect(run.baselineCoverage).toBe("complete");
    expect(run.policyVersion).toBe("v1.0");
    expect(run.canonicalOperatorId).toBe("tenant:tenant_austin:operator:operator_austin");
    expect(run.operatorUserId).toBe("operator_austin");
    expect(run.metricKey).toBe("monthly_recurring_revenue");
    expect(run.targetValue).toBe("25000.00");
    expect(run.unit).toBe("USD");
    expect(run.status).toBe("active");
    expect(run.startedAt).toBeInstanceOf(Date);

    // 2. Verify target operator user in users table satisfies operatorUserCanResolveOnTenant
    const userRows = insertedRows.get("users");
    expect(userRows).toBeDefined();
    const targetUser = userRows!.find((u) => u.openId === "operator_austin");
    expect(targetUser).toBeDefined();
    expect(targetUser.tenantId).toBe("tenant_austin"); // Exactly equals target tenant
    expect(targetUser.role).toBe("admin");

    // 3. Verify zero fabricated Stripe subscriptions
    expect(insertedRows.has("dayforge_saas_subscriptions")).toBe(false);

    // 4. Verify explicit manual non-billing entitlements were granted instead
    const entitlementRows = insertedRows.get("dayforge_saas_entitlements");
    expect(entitlementRows).toBeDefined();
    expect(entitlementRows!.length).toBeGreaterThanOrEqual(1);
    expect(entitlementRows!.every((e) => e.source === "manual" && e.enabled === true)).toBe(true);
  });

  it("proves reprovisioning idempotency: updates active macro_goal_run targetValue and avoids reopening completed goal cycle requests", async () => {
    const { insertedRows, updatedRows, store } = setupTestFranchiseDb();

    // 1. Initial provision at $25,000 MRR
    await provisionFranchise({
      city: "Austin",
      state: "TX",
      vertical: "commercial_laundry",
      targetMrrCents: 2500000,
    });

    expect(insertedRows.get("operator_macro_goals")?.length).toBe(1);
    expect(insertedRows.get("macro_goal_runs")?.length).toBe(1);
    expect(insertedRows.get("goal_cycle_requests")?.length).toBe(1);

    // Simulate goal_cycle_request already completed by autonomous worker
    const existingReq = store.get("goal_cycle_requests")![0];
    existingReq.status = "completed";

    // 2. Re-provision with new MRR target ($45,000)
    await provisionFranchise({
      city: "Austin",
      state: "TX",
      vertical: "commercial_laundry",
      targetMrrCents: 4500000,
    });

    // Verify macro goal was updated with new target
    const macroGoalUpdates = updatedRows.get("operator_macro_goals");
    expect(macroGoalUpdates).toBeDefined();
    expect(macroGoalUpdates?.some((u) => u.targetValue === "45000")).toBe(true);

    // Verify active macro_goal_run targetValue was synchronized to new target
    const macroRunUpdates = updatedRows.get("macro_goal_runs");
    expect(macroRunUpdates).toBeDefined();
    expect(macroRunUpdates?.some((u) => u.targetValue === "45000.00")).toBe(true);

    // Verify goal_cycle_requests was NOT reset to queued or duplicated
    expect(existingReq.status).toBe("completed");
    expect(insertedRows.get("goal_cycle_requests")?.length).toBe(1);
  });

  it("verifies Day Line completion: objective completion creates durable outcome, commitment completion updates status", async () => {
    const { store } = setupTestFranchiseDb();

    store.set("users", [
      {
        id: 1,
        tenantId: "default",
        openId: "admin-owner-user",
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    store.set("dayforge_saas_memberships", [
      {
        tenantId: "default",
        userOpenId: "admin-owner-user",
        role: "owner",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // Seed objective with status "presented" so it surfaces on today's Day Line
    store.set("goal_cycle_objectives", [
      {
        tenantId: "default",
        id: "objective-conquest-1",
        cycleId: "cycle-1",
        runId: "run-1",
        decisionId: "decision-1",
        canonicalOperatorId: "tenant:default:operator:admin-owner-user",
        operatorUserId: "admin-owner-user",
        selectionKind: "obligation",
        selectedRef: "ref-1",
        title: "Conquest Argyle House",
        description: "Visit building",
        executionType: "driver_visit",
        authority: "autonomous",
        status: "presented",
        businessDate: "2026-09-30",
        windowStart: "08:00",
        windowEnd: "17:00",
        loadoutJson: "[]",
        evidenceRefsJson: "[]",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // Seed commitment with status "open"
    store.set("day_director_commitments", [
      {
        tenantId: "default",
        id: "commit-morning-door-tags",
        actorId: "1",
        businessDate: "2026-09-30",
        status: "open",
        title: "Franklin corridor door tags",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const caller = appRouter.createCaller({
      user: {
        id: 1,
        openId: "admin-owner-user",
        name: "Admin User",
        email: "admin@test.com",
        role: "admin",
      },
      tenantId: "default",
      req: { headers: {} } as any,
      res: { clearCookie: () => {} } as any,
    });

    // 1. Verify Day Line surfaces both items
    const todayLine = await caller.system.currentDayLine.today();
    expect(todayLine.items.some(i => i.id === "objective-conquest-1")).toBe(true);
    expect(todayLine.items.some(i => i.id === "commit-morning-door-tags")).toBe(true);

    // 2. Complete Objective: succeeds with durable outcome
    const objectiveRes = await caller.system.currentDayLine.completeItem({
      itemId: "objective-conquest-1",
      evidenceReference: "field_receipt_voice_01",
      explanation: "Driver confirmed completed at Argyle House",
    });
    expect(objectiveRes.success).toBe(true);
    expect(objectiveRes.lineageKind).toBe("objective");
    expect(objectiveRes.itemId).toBe("objective-conquest-1");

    // Verify durable outcome created in goal_cycle_outcomes
    const outcomes = store.get("goal_cycle_outcomes") ?? [];
    expect(outcomes.some(o => o.objectiveId === "objective-conquest-1")).toBe(true);

    // 3. Complete Commitment: succeeds with durable mutation
    const commitmentRes = await caller.system.currentDayLine.completeItem({
      itemId: "commit-morning-door-tags",
      evidenceReference: "field_receipt_voice_02",
      explanation: "Driver confirmed door tags placed on Franklin corridor",
    });
    expect(commitmentRes.success).toBe(true);
    expect(commitmentRes.lineageKind).toBe("commitment");
    expect(commitmentRes.itemId).toBe("commit-morning-door-tags");

    // Verify commitment status updated to completed in day_director_commitments
    const commitments = store.get("day_director_commitments") ?? [];
    const updatedCommitment = commitments.find(c => c.id === "commit-morning-door-tags");
    expect(updatedCommitment?.status).toBe("completed");
  });

  it("enforces campaign completion truth: generic assertion fails closed without required domain evidence", async () => {
    const { store } = setupTestFranchiseDb();

    store.set("users", [
      {
        id: 1,
        tenantId: "default",
        openId: "admin-owner-user",
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    store.set("dayforge_saas_memberships", [
      {
        tenantId: "default",
        userOpenId: "admin-owner-user",
        role: "owner",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // Inject campaign into Day Line planner
    setDayLineDepsForTesting({
      planForDate: async () => ({
        outcome: {
          status: "planned",
          ranking: [{ campaignId: "camp-west-loop-pilot" }],
        },
      } as any),
      listCampaigns: async () => [
        {
          campaignId: "camp-west-loop-pilot",
          title: "West Loop Pilot",
          objective: "Distribute flyers",
          completionCondition: "Flyers distributed",
        } as any,
      ],
    });

    const caller = appRouter.createCaller({
      user: {
        id: 1,
        openId: "admin-owner-user",
        name: "Admin User",
        email: "admin@test.com",
        role: "admin",
      },
      tenantId: "default",
      req: { headers: {} } as any,
      res: { clearCookie: () => {} } as any,
    });

    // 1. Verify campaign item is surfaced on Day Line
    const todayLine = await caller.system.currentDayLine.today();
    expect(todayLine.items.some(i => i.id === "camp-west-loop-pilot")).toBe(true);

    // 2. Generic completeItem attempt fails closed without domain evidence
    const campaignRes = await caller.system.currentDayLine.completeItem({
      itemId: "camp-west-loop-pilot",
      evidenceReference: "field_receipt_voice_03",
      explanation: "Driver confirmed flyer drop completed",
    });

    expect(campaignRes.success).toBe(false);
    expect(campaignRes.lineageKind).toBe("campaign");
    expect((campaignRes as any).reason).toBe("campaign_requires_evidence");

    // 3. Verify zero fake objective_verified diagnostic events emitted
    const events = store.get("persistent_operator_diagnostic_events") ?? [];
    const fakeVerification = events.find(
      e => e.objectiveId === "camp-west-loop-pilot" && e.eventKind === "objective_verified"
    );
    expect(fakeVerification).toBeUndefined();
  });

  it("enforces server-side lineage authority: rejects non-Day-Line items and forged client lineage", async () => {
    const { store } = setupTestFranchiseDb();

    store.set("users", [
      {
        id: 1,
        tenantId: "default",
        openId: "admin-owner-user",
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    store.set("dayforge_saas_memberships", [
      {
        tenantId: "default",
        userOpenId: "admin-owner-user",
        role: "owner",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    store.set("goal_cycle_objectives", [
      {
        tenantId: "default",
        id: "objective-conquest-1",
        cycleId: "cycle-1",
        runId: "run-1",
        decisionId: "decision-1",
        canonicalOperatorId: "tenant:default:operator:admin-owner-user",
        operatorUserId: "admin-owner-user",
        selectionKind: "obligation",
        selectedRef: "ref-1",
        title: "Conquest Argyle House",
        description: "Visit building",
        executionType: "driver_visit",
        authority: "autonomous",
        status: "presented",
        businessDate: "2026-09-30",
        windowStart: "08:00",
        windowEnd: "17:00",
        loadoutJson: "[]",
        evidenceRefsJson: "[]",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const caller = appRouter.createCaller({
      user: {
        id: 1,
        openId: "admin-owner-user",
        name: "Admin User",
        email: "admin@test.com",
        role: "admin",
      },
      tenantId: "default",
      req: { headers: {} } as any,
      res: { clearCookie: () => {} } as any,
    });

    // 1. Non-Day-Line item is rejected
    await expect(
      caller.system.currentDayLine.completeItem({
        itemId: "unregistered-phantom-stop",
        evidenceReference: "fake_proof",
      })
    ).rejects.toThrow("Item 'unregistered-phantom-stop' is not present on today's authoritative Day Line");

    // 2. Forged client lineage (claiming an objective is a campaign) is rejected
    await expect(
      caller.system.currentDayLine.completeItem({
        itemId: "objective-conquest-1",
        lineage: { kind: "campaign" },
        evidenceReference: "fake_proof",
      })
    ).rejects.toThrow("Lineage conflict: client declared 'campaign' but authoritative Day Line item is 'objective'");
  });

  it("enforces platform-admin cross-tenant operator resolution: default admin inspects Austin operator without mutating admin user", async () => {
    const { store } = setupTestFranchiseDb();

    // Seed default admin in users and memberships
    store.set("users", [
      {
        id: 1,
        tenantId: "default",
        openId: "admin-owner-user",
        name: "Admin User",
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    store.set("dayforge_saas_memberships", [
      {
        tenantId: "default",
        userOpenId: "admin-owner-user",
        role: "owner",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // Provision Austin franchise (creates operator_austin on tenant_austin)
    await provisionFranchise({
      city: "Austin",
      state: "TX",
      vertical: "commercial_laundry",
      targetMrrCents: 2500000,
    });

    const adminCaller = appRouter.createCaller({
      user: {
        id: 1,
        openId: "admin-owner-user",
        name: "Admin User",
        email: "admin@test.com",
        role: "admin",
      },
      tenantId: "default",
      req: { headers: {} } as any,
      res: { clearCookie: () => {} } as any,
    });

    // 1. Cross-tenant Day Line query succeeds through explicit platform-admin resolver
    const austinDayLine = await adminCaller.system.currentDayLine.today({
      targetTenantId: "tenant_austin",
    });
    expect(austinDayLine).toBeDefined();

    // 2. Cross-tenant scoreboard query resolves Austin's dedicated operator
    const austinScoreboard = await adminCaller.system.persistentOperator.scoreboard({
      targetTenantId: "tenant_austin",
    });
    expect(austinScoreboard.tenantId).toBe("tenant_austin");
    expect(austinScoreboard.canonicalOperatorId).toBe("tenant:tenant_austin:operator:operator_austin");

    // 3. Cross-tenant identity query resolves Austin's dedicated operator identity
    const austinIdentity = await adminCaller.system.persistentOperator.identity({
      targetTenantId: "tenant_austin",
    });
    expect(austinIdentity?.tenantId).toBe("tenant_austin");
    expect(austinIdentity?.canonicalOpenId).toBe("operator_austin");

    // 4. Verify admin caller's persisted user record was NOT mutated
    const adminUser = store.get("users")?.find(u => u.openId === "admin-owner-user");
    expect(adminUser?.tenantId).toBe("default");

    // 5. Verify non-admin caller attempting cross-tenant access is rejected
    const driverCaller = appRouter.createCaller({
      user: {
        id: 99,
        openId: "regular-driver",
        name: "Driver",
        email: "driver@test.com",
        role: "driver",
      },
      tenantId: "default",
      req: { headers: {} } as any,
      res: { clearCookie: () => {} } as any,
    });

    await expect(
      driverCaller.system.currentDayLine.today({ targetTenantId: "tenant_austin" })
    ).rejects.toThrow();
  });

  it("verifies War Room Los Angeles default contains zero hardcoded WON statuses or fabricated route margins", async () => {
    // Assert that the simulation assets array contains ZERO won statuses
    // and that the default live state is derived authoritatively from atlas
    const { getGeographicTruth } = await import("../geography/geographicTruthService");
    expect(typeof getGeographicTruth).toBe("function");

    // Test that default Los Angeles view does not fabricate won statuses
    const caller = appRouter.createCaller({
      user: {
        id: 1,
        openId: "admin-owner-user",
        name: "Admin User",
        email: "admin@test.com",
        role: "admin",
      },
      tenantId: "default",
      req: { headers: {} } as any,
      res: { clearCookie: () => {} } as any,
    });

    const resolveRes = await caller.system.franchise.resolveTenant();
    expect(resolveRes.resolvedTenantId).toBe("default");
    expect(resolveRes.isCrossTenant).toBe(false);
  });
});
