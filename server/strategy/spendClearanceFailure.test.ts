import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as dbModule from "../db";
import {
  commitSpend,
  getMonthToDateSpend,
  releaseSpend,
  reserveSpend,
  resetInMemorySpendLedgerForTesting,
} from "./spendClearance";
import {
  resetInMemoryRulesForTesting,
  setPlaygroundRules,
} from "./playgroundRulesService";

describe("Guardrail G6: Fail-Closed & Concurrency Regression Tests", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    resetInMemoryRulesForTesting();
    resetInMemorySpendLedgerForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  describe("G6 Fail-Closed on Database Errors", () => {
    it("fails closed (cleared: false) when the database transaction throws an error", async () => {
      const tenant = "t-db-err";
      await setPlaygroundRules({
        tenantId: tenant,
        monthlySpendCeilingCents: 50000, // Ample ceiling
        approvalCategories: [],
      });

      // Mock getDb to return a database client that throws during transaction
      const mockDb = {
        transaction: vi.fn().mockRejectedValue(new Error("Database connection lost (ECONNRESET)")),
      };
      vi.spyOn(dbModule, "getDb").mockResolvedValue(mockDb as any);

      const result = await reserveSpend({
        tenantId: tenant,
        category: "growth_ops",
        amountCents: 1000,
        businessMonth: "2026-09",
      });

      // Strict fail-closed verification: clearance MUST be denied
      expect(result.cleared).toBe(false);
      expect(result.status).toBe("over_ceiling");
      expect(result.reason).toContain("database_error");
      expect(result.reason).toContain("ECONNRESET");
      expect(result.reservationId).toBeUndefined();
    });

    it("fails closed when the database throws a transaction serialization deadlock", async () => {
      const tenant = "t-db-deadlock";
      await setPlaygroundRules({
        tenantId: tenant,
        monthlySpendCeilingCents: 50000,
        approvalCategories: [],
      });

      const mockDb = {
        transaction: vi.fn().mockRejectedValue(new Error("Deadlock found when trying to get lock; try restarting transaction")),
      };
      vi.spyOn(dbModule, "getDb").mockResolvedValue(mockDb as any);

      const result = await reserveSpend({
        tenantId: tenant,
        category: "growth_ops",
        amountCents: 2500,
        businessMonth: "2026-09",
      });

      expect(result.cleared).toBe(false);
      expect(result.status).toBe("over_ceiling");
      expect(result.reason).toContain("database_error");
      expect(result.reason).toContain("Deadlock");
    });
  });

  describe("Production Environment Invariants", () => {
    it("fails closed when database is null in production mode", async () => {
      process.env.NODE_ENV = "production";
      vi.spyOn(dbModule, "getDb").mockResolvedValue(null);

      const tenant = "t-prod-no-db";
      await setPlaygroundRules({
        tenantId: tenant,
        monthlySpendCeilingCents: 50000,
        approvalCategories: [],
      });

      const result = await reserveSpend({
        tenantId: tenant,
        category: "growth_ops",
        amountCents: 1000,
        businessMonth: "2026-09",
      });

      expect(result.cleared).toBe(false);
      expect(result.status).toBe("over_ceiling");
      expect(result.reason).toBe("database_unavailable_in_production");
    });

    it("rejects commitSpend and releaseSpend in production when database fails", async () => {
      process.env.NODE_ENV = "production";
      const mockDb = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockRejectedValue(new Error("DB write failure")),
          }),
        }),
      };
      vi.spyOn(dbModule, "getDb").mockResolvedValue(mockDb as any);

      const committed = await commitSpend({
        tenantId: "t-prod-fail",
        dedupeKey: "key-1",
      });
      expect(committed).toBe(false);

      const released = await releaseSpend({
        tenantId: "t-prod-fail",
        dedupeKey: "key-1",
      });
      expect(released).toBe(false);
    });

    it("throws on getMonthToDateSpend in production when database fails", async () => {
      process.env.NODE_ENV = "production";
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockRejectedValue(new Error("DB read failure")),
          }),
        }),
      };
      vi.spyOn(dbModule, "getDb").mockResolvedValue(mockDb as any);

      await expect(
        getMonthToDateSpend("t-prod-fail", "2026-09")
      ).rejects.toThrow("Spend ledger database unavailable");
    });
  });

  describe("High-Concurrency Race Condition Safety", () => {
    it("prevents race conditions and strictly respects ceiling under parallel requests", async () => {
      const tenant = "t-concurrency-guard";
      const ceilingCents = 10000; // $100 ceiling
      const requestAmountCents = 2500; // $25 each
      const numRequests = 10; // Total requested = $250

      await setPlaygroundRules({
        tenantId: tenant,
        monthlySpendCeilingCents: ceilingCents,
        approvalCategories: [],
      });

      // Fire 10 parallel requests simultaneously
      const results = await Promise.all(
        Array.from({ length: numRequests }, (_, i) =>
          reserveSpend({
            tenantId: tenant,
            category: "growth_ops",
            amountCents: requestAmountCents,
            businessMonth: "2026-09",
            dedupeKey: `parallel-req-${i}`,
          })
        )
      );

      const cleared = results.filter(r => r.cleared);
      const rejected = results.filter(r => !r.cleared);

      // Exactly 4 requests should succeed ($25 * 4 = $100)
      expect(cleared.length).toBe(4);
      // Exactly 6 requests should be blocked
      expect(rejected.length).toBe(6);

      for (const rej of rejected) {
        expect(rej.status).toBe("over_ceiling");
        expect(rej.reason).toBe("over_monthly_spend_ceiling");
      }

      // Check month-to-date total spend
      const summary = await getMonthToDateSpend(tenant, "2026-09");
      expect(summary.plannedCents).toBe(10000);
      expect(summary.remainingCents).toBe(0);
    });

    it("guarantees idempotency under concurrent identical dedupeKey requests", async () => {
      const tenant = "t-idempotent-race";
      await setPlaygroundRules({
        tenantId: tenant,
        monthlySpendCeilingCents: 5000, // $50 ceiling
        approvalCategories: [],
      });

      // 5 concurrent requests with identical dedupeKey
      const dedupeKey = "idempotent-spend-race-key";
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          reserveSpend({
            tenantId: tenant,
            category: "growth_ops",
            amountCents: 3000,
            businessMonth: "2026-09",
            dedupeKey,
          })
        )
      );

      // All 5 must return cleared: true with the same reservationId
      expect(results.every(r => r.cleared)).toBe(true);
      const firstId = results[0]!.reservationId;
      expect(firstId).toBeDefined();
      expect(results.every(r => r.reservationId === firstId)).toBe(true);

      // Total ledger spend must only be counted ONCE ($30, not $150)
      const summary = await getMonthToDateSpend(tenant, "2026-09");
      expect(summary.plannedCents).toBe(3000);
      expect(summary.remainingCents).toBe(2000);
    });
  });

  // Real database test executed when a real database connection is available
  const hasRealDb = Boolean(process.env.DATABASE_URL);
  const describeWithRealDb = hasRealDb ? describe : describe.skip;

  describeWithRealDb("Real Database Concurrency & Failure Suite", () => {
    it("enforces serializable isolation and ceiling limit against real MySQL", async () => {
      const db = await dbModule.getDb();
      if (!db) return;

      const tenant = `t-realdb-${Date.now()}`;
      await setPlaygroundRules({
        tenantId: tenant,
        monthlySpendCeilingCents: 6000, // $60
        approvalCategories: [],
      });

      // 8 concurrent requests of $20 against real database
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          reserveSpend({
            tenantId: tenant,
            category: "real_db_ops",
            amountCents: 2000,
            businessMonth: "2026-09",
            dedupeKey: `realdb-req-${tenant}-${i}`,
          })
        )
      );

      const cleared = results.filter(r => r.cleared);
      const rejected = results.filter(r => !r.cleared);

      // At most 3 can clear ($60 limit)
      expect(cleared.length).toBe(3);
      expect(rejected.length).toBe(5);

      const summary = await getMonthToDateSpend(tenant, "2026-09");
      expect(summary.plannedCents).toBe(6000);
      expect(summary.remainingCents).toBe(0);
    });
  });
});
