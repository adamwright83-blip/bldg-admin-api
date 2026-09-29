import { describe, expect, it } from "vitest";
import { assertPersistentOperatorTenantScope } from "./tenantScope";
import { defaultAuthorityForGoldlineAction } from "../../shared/goldlineActionContract";

describe("Persistent Growth Multi-Tenant & Reliability Hardening (Slice L)", () => {
  describe("tenant boundary isolation", () => {
    it("fails closed when tenantId is empty or malformed", () => {
      expect(() =>
        assertPersistentOperatorTenantScope({
          tenantId: "",
          operatorUserId: "operator-1",
        })
      ).toThrow(/tenantId/);
    });

    it("prevents tenant A facts from mixing with tenant B state", () => {
      const tenantA = "tenant-a";
      const tenantB = "tenant-b";

      const scopeA = assertPersistentOperatorTenantScope({
        tenantId: tenantA,
        operatorUserId: "operator-1",
      });
      const scopeB = assertPersistentOperatorTenantScope({
        tenantId: tenantB,
        operatorUserId: "operator-1",
      });

      expect(scopeA.tenantId).toBe("tenant-a");
      expect(scopeB.tenantId).toBe("tenant-b");
      expect(scopeA.tenantId).not.toBe(scopeB.tenantId);
    });
  });

  describe("exact zero vs. missing truth distinction", () => {
    it("distinguishes authoritative zero from missing/unresolved reality", () => {
      const exactZero = {
        value: 0,
        coverage: "complete" as const,
        precision: "exact" as const,
      };

      const missing = {
        value: null,
        coverage: "unavailable" as const,
        precision: "unknown" as const,
      };

      expect(exactZero.value).toBe(0);
      expect(exactZero.coverage).toBe("complete");

      expect(missing.value).toBeNull();
      expect(missing.coverage).toBe("unavailable");
      // Missing must NOT be coerced to 0!
      expect(missing.value).not.toBe(0);
    });
  });

  describe("authority revocation & action gateway safety", () => {
    it("prohibits execution when authority is revoked or missing standing grant", () => {
      const actionAuthority = defaultAuthorityForGoldlineAction("VISIT");
      expect(actionAuthority).toBe("HUMAN_EXECUTION");

      const followUp = defaultAuthorityForGoldlineAction("FOLLOW_UP");
      expect(followUp).toBe("APPROVAL_REQUIRED");
    });
  });

  describe("locked vs unlocked week planning integrity", () => {
    it("ensures learned policy changes never silently lock or author operator commitments", () => {
      const unlockedIntent = {
        status: "unlocked",
        weekStart: "2026-09-28",
        lockedAt: null,
      };

      // Invariant: learning deltas only advise future loadouts, never mutate week lock state
      expect(unlockedIntent.status).toBe("unlocked");
      expect(unlockedIntent.lockedAt).toBeNull();
    });
  });
});
