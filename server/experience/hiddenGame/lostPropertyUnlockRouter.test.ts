import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../../_core/context";
import { CanonicalOperatorIdentityError, type CanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import type { LostPropertyUnlockRead } from "../../../shared/lostPropertyUnlock";
import {
  createLostPropertyUnlockRouter,
  type LostPropertyUnlockRouterDeps,
} from "./lostPropertyUnlockRouter";

const read: LostPropertyUnlockRead = {
  ruleVersion: 2,
  objectivesPerChapter: 3,
  unlockedChapters: 1,
  nextChapter: 2,
  objectivesRemaining: 3,
  firstSaleTerritoryId: "koreatown",
  firstSaleOccurredAt: "2026-10-01T18:00:00.000Z",
  firstSaleEventKey: "order:9",
  nextUnlockRequirement: "complete_objectives",
  preview: false,
  chapters: [{ chapter: 1, openedAt: "2026-10-01T18:00:00.000Z" }],
  objectiveCounts: { afterChapter1: 0, afterChapter2: 0 },
};

function identity(patch: Partial<CanonicalOperatorIdentity> = {}): CanonicalOperatorIdentity {
  return {
    tenantId: "default",
    canonicalOperatorId: "tenant:default:operator:open-1",
    canonicalOpenId: "open-1",
    canonicalUserId: 7,
    sourceOpenId: "open-1",
    sourceUserId: 7,
    sourceRole: "admin",
    dayDirectorActorId: "7",
    dayDirectorActorIds: ["7", "7", " 9 "],
    weeklyOperatorId: "open-1",
    campaignOperatorUserId: "open-1",
    communicationOperatorUserId: "open-1",
    membership: { source: "owner", canonical: "owner" },
    aliases: [{ openId: " alias-1 ", userId: 8, role: "driver", surface: "driver" }],
    ...patch,
  };
}

function context(patch: { tenantId?: string; user?: TrpcContext["user"] }): TrpcContext {
  return {
    req: undefined,
    res: undefined,
    user: patch.user === undefined
      ? ({ id: 7, openId: "open-1", role: "admin" } as TrpcContext["user"])
      : patch.user,
    vendorSession: null,
    tenantId: patch.tenantId ?? "default",
  } as unknown as TrpcContext;
}

function harness(patch: Partial<LostPropertyUnlockRouterDeps> = {}) {
  const deps: LostPropertyUnlockRouterDeps = {
    resolveIdentity: vi.fn(async () => identity()),
    readUnlock: vi.fn(async () => read),
    ...patch,
  };
  return { deps, caller: createLostPropertyUnlockRouter(deps).createCaller(context({})) };
}

describe("lostProperty.eligibility", () => {
  it("is a query that returns the unlock read for the session operator", async () => {
    const { deps, caller } = harness();
    await expect(caller.eligibility()).resolves.toEqual(read);
    expect(deps.resolveIdentity).toHaveBeenCalledWith({
      tenantId: "default",
      user: { id: 7, openId: "open-1", role: "admin" },
    });
    expect(deps.readUnlock).toHaveBeenCalledWith({
      tenantId: "default",
      canonicalOperatorId: "tenant:default:operator:open-1",
      actorIds: ["7", "9"],
      operatorOpenIds: ["open-1", "alias-1"],
    });
  });

  it("refuses a signed-out caller before any read", async () => {
    const deps: LostPropertyUnlockRouterDeps = {
      resolveIdentity: vi.fn(async () => identity()),
      readUnlock: vi.fn(async () => read),
    };
    const caller = createLostPropertyUnlockRouter(deps).createCaller(context({ user: null }));
    await expect(caller.eligibility()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(deps.resolveIdentity).not.toHaveBeenCalled();
    expect(deps.readUnlock).not.toHaveBeenCalled();
  });

  it("refuses a tenant the caller does not belong to", async () => {
    const deps: LostPropertyUnlockRouterDeps = {
      resolveIdentity: vi.fn(async () => identity()),
      readUnlock: vi.fn(async () => read),
    };
    const caller = createLostPropertyUnlockRouter(deps).createCaller(
      context({
        tenantId: "other-tenant",
        user: { id: 7, openId: "open-1", role: "user" } as TrpcContext["user"],
      })
    );
    await expect(caller.eligibility()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deps.readUnlock).not.toHaveBeenCalled();
  });

  it("does not read when the resolved operator belongs to another tenant", async () => {
    const { deps, caller } = harness({
      resolveIdentity: vi.fn(async () => identity({ tenantId: "tenant-b" })),
    });
    await expect(caller.eligibility()).rejects.toBeInstanceOf(TRPCError);
    await expect(caller.eligibility()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deps.readUnlock).not.toHaveBeenCalled();
  });

  it("does not read when operator identity is unresolved", async () => {
    const { deps, caller } = harness({
      resolveIdentity: vi.fn(async () => {
        throw new CanonicalOperatorIdentityError("identity_unresolved");
      }),
    });
    await expect(caller.eligibility()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(deps.readUnlock).not.toHaveBeenCalled();
  });
});

describe("lostProperty router source", () => {
  const source = readFileSync(new URL("./lostPropertyUnlockRouter.ts", import.meta.url), "utf8");
  const system = readFileSync(new URL("../../_core/systemRouter.ts", import.meta.url), "utf8");

  it("is mounted as one query and does not write or take client evidence", () => {
    expect(source).toContain("eligibility: legacyDayforgeTenantMemberProcedure.query");
    expect(source).not.toMatch(/\.mutation\s*\(/);
    expect(source).not.toMatch(/\.input\s*\(/);
    expect(source).not.toMatch(/\.(insert|update|delete)\s*\(/);
    expect(source).not.toContain("drizzle/schema");
    expect(system).toContain("lostProperty: lostPropertyUnlockRouter");
  });
});
