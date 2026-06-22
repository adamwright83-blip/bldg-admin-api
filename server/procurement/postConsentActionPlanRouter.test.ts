import { describe, expect, it, vi } from "vitest";
import { createPostConsentActionPlanRouter } from "./postConsentActionPlanRouter";

function context(user: { id: number; role: "admin" | "user" } | null) {
  return { user, tenantId: "default", req: {}, res: {} } as never;
}

const PLAN = {
  id: "plan-1", consentId: "consent-1", proposalVersionId: "version-1", tenantId: "default", bldgUserId: 1,
  status: "draft_vendor_outreach" as const, reasons: ["eligible"], eligibleForAutoSendPilot: false,
  proposalVersionSnapshotHash: "a".repeat(64), createdBy: "admin:1", createdAt: new Date(), updatedAt: new Date(),
};

const DRAFT = {
  id: "draft-1", planId: "plan-1", consentId: "consent-1", proposalVersionId: "version-1", tenantId: "default",
  bldgUserId: 1, vendorCandidateId: "candidate-1", serviceCategory: "dog_grooming",
  templateKey: "vendor_availability_request_v0", templateVersion: "v1", subjectRendered: "Quick availability check",
  draftBody: "rendered", draftBodyHash: "b".repeat(64), variables: {}, founderEscalationPresent: true,
  status: "drafted" as const, createdBy: "admin:1", createdAt: new Date(), updatedAt: new Date(),
};

describe("post-consent action plan admin router", () => {
  it("rejects unauthenticated and non-admin access before store access", async () => {
    const store = { runPlan: vi.fn(), getPlanByConsentId: vi.fn(), getDraftByPlanId: vi.fn(), listPlans: vi.fn() };
    const router = createPostConsentActionPlanRouter(store as never);
    await expect(router.createCaller(context(null)).get({ consentId: "consent-1" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(router.createCaller(context({ id: 1, role: "user" })).run({ consentId: "consent-1" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.runPlan).not.toHaveBeenCalled();
    expect(store.getPlanByConsentId).not.toHaveBeenCalled();
  });

  it("get returns null plan/draft when no plan exists yet", async () => {
    const store = { runPlan: vi.fn(), getPlanByConsentId: vi.fn(async () => null), getDraftByPlanId: vi.fn() };
    const result = await createPostConsentActionPlanRouter(store as never)
      .createCaller(context({ id: 1, role: "admin" })).get({ consentId: "consent-1" });
    expect(result).toEqual({ plan: null, draft: null });
    expect(store.getDraftByPlanId).not.toHaveBeenCalled();
  });

  it("get returns the plan and draft when a draft was created", async () => {
    const store = { runPlan: vi.fn(), getPlanByConsentId: vi.fn(async () => PLAN), getDraftByPlanId: vi.fn(async () => DRAFT) };
    const result = await createPostConsentActionPlanRouter(store as never)
      .createCaller(context({ id: 1, role: "admin" })).get({ consentId: "consent-1" });
    expect(result.plan).toEqual(PLAN);
    expect(result.draft).toEqual(DRAFT);
    expect(store.getDraftByPlanId).toHaveBeenCalledWith("plan-1");
  });

  it("get returns a null draft for a blocked plan", async () => {
    const blockedPlan = { ...PLAN, status: "blocked_expired" as const };
    const store = { runPlan: vi.fn(), getPlanByConsentId: vi.fn(async () => blockedPlan), getDraftByPlanId: vi.fn(async () => null) };
    const result = await createPostConsentActionPlanRouter(store as never)
      .createCaller(context({ id: 1, role: "admin" })).get({ consentId: "consent-1" });
    expect(result.draft).toBeNull();
  });

  it("run invokes the planner and returns the decision/plan/draft", async () => {
    const decision = { status: "draft_vendor_outreach", allowed: true, reasons: ["eligible"] } as never;
    const store = {
      runPlan: vi.fn(async () => ({ decision, plan: PLAN, draft: DRAFT })),
      getPlanByConsentId: vi.fn(), getDraftByPlanId: vi.fn(),
    };
    const result = await createPostConsentActionPlanRouter(store as never)
      .createCaller(context({ id: 7, role: "admin" })).run({ consentId: "consent-1" });
    expect(result.decision).toEqual(decision);
    expect(result.plan).toEqual(PLAN);
    expect(result.draft).toEqual(DRAFT);
    expect(store.runPlan).toHaveBeenCalledWith(expect.objectContaining({ consentId: "consent-1", createdBy: "admin:7" }));
  });

  it("run maps a not-found consent to NOT_FOUND without leaking internals", async () => {
    const store = {
      runPlan: vi.fn().mockRejectedValue(new Error("Resident proposal consent not found")),
      getPlanByConsentId: vi.fn(), getDraftByPlanId: vi.fn(),
    };
    await expect(createPostConsentActionPlanRouter(store as never)
      .createCaller(context({ id: 1, role: "admin" })).run({ consentId: "missing" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("list returns a paginated page of plans without requiring a consentId", async () => {
    const page = { items: [PLAN], page: { limit: 20, offset: 0, hasMore: false } };
    const store = { runPlan: vi.fn(), getPlanByConsentId: vi.fn(), getDraftByPlanId: vi.fn(), listPlans: vi.fn(async () => page) };
    const result = await createPostConsentActionPlanRouter(store as never)
      .createCaller(context({ id: 1, role: "admin" })).list({ limit: 20, offset: 0 });
    expect(result).toEqual(page);
    expect(store.listPlans).toHaveBeenCalledWith({ limit: 20, offset: 0 });
  });

  it("list rejects unauthenticated and non-admin access before store access", async () => {
    const store = { runPlan: vi.fn(), getPlanByConsentId: vi.fn(), getDraftByPlanId: vi.fn(), listPlans: vi.fn() };
    const router = createPostConsentActionPlanRouter(store as never);
    await expect(router.createCaller(context(null)).list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(router.createCaller(context({ id: 1, role: "user" })).list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.listPlans).not.toHaveBeenCalled();
  });

  it("contains exactly one mutation -- run -- and two queries -- list, get", () => {
    const router = createPostConsentActionPlanRouter({ runPlan: vi.fn(), getPlanByConsentId: vi.fn(), getDraftByPlanId: vi.fn(), listPlans: vi.fn() } as never);
    expect(Object.keys(router._def.record)).toEqual(["list", "get", "run"]);
  });
});
