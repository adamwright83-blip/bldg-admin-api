import type express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../_core/sdk", () => ({ sdk: { authenticateRequest: vi.fn() } }));
vi.mock("../agents/s2sEndpoint", () => ({ isValidAgentSharedSecret: vi.fn().mockReturnValue(false) }));
vi.mock("../procurement/migrations", () => ({
  createProcurementPool: vi.fn(() => {
    throw new Error("createProcurementPool should never be called when an orchestrator is injected for tests");
  }),
}));

const { sdk } = await import("../_core/sdk");
const { isValidAgentSharedSecret } = await import("../agents/s2sEndpoint");
const { registerMarketplacePaymentInternalRoutes } = await import("./marketplacePaymentInternalRoute");

const ORIGINAL_ENABLED = process.env.MARKETPLACE_PAYMENTS_ENABLED;
afterEach(() => {
  vi.clearAllMocks();
  if (ORIGINAL_ENABLED === undefined) delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
  else process.env.MARKETPLACE_PAYMENTS_ENABLED = ORIGINAL_ENABLED;
});

function makeFakeApp() {
  const handlers = new Map<string, express.RequestHandler>();
  const app = { post: (path: string, handler: express.RequestHandler) => { handlers.set(path, handler); } };
  return { app: app as unknown as express.Express, handlers };
}

function makeReqRes(body: unknown, headers: Record<string, string> = {}) {
  const req = { body, headers, query: {} } as unknown as express.Request;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status } as unknown as express.Response;
  return { req, res, status, json };
}

function makeOrchestratorStub() {
  return {
    evaluateAuthorizationRequest: vi.fn(),
    evaluateAndCreateAuthorization: vi.fn(),
    evaluateCaptureReadiness: vi.fn(),
    evaluateAndCreateCapture: vi.fn(),
    enqueueAuthorizationWorkflowStep: vi.fn(),
  };
}

const now = new Date("2026-06-19T12:00:00.000Z");
const authorityBody = {
  authorityType: "guest_readiness",
  status: "active",
  budgetCapCents: 30_000,
  deadlineAt: "2026-06-22T12:00:00.000Z",
  expiresAt: "2026-06-22T12:00:00.000Z",
  revokedAt: null,
  allowedRiskCategories: ["low", "medium"],
  disallowedCategories: [],
  accessConstraints: { allowedPatterns: ["no_entry"] },
};
const actionBody = {
  authorityType: "guest_readiness",
  category: "flowers",
  spendCents: 5_000,
  scheduledAt: "2026-06-20T12:00:00.000Z",
  accessPattern: "no_entry",
};
const acceptanceBody = {
  acceptanceType: "provider_accepted",
  acceptanceStatus: "accepted",
  expiresAt: "2026-06-21T12:00:00.000Z",
  serviceWindowStart: "2026-06-20T10:00:00.000Z",
  serviceWindowEnd: "2026-06-20T12:00:00.000Z",
  acceptedPriceCents: 5_000,
};

describe("Marketplace payment internal routes — auth guard", () => {
  it("fails closed with 401 when neither admin session nor agent shared secret is present", async () => {
    vi.mocked(sdk.authenticateRequest).mockRejectedValue(new Error("no session"));
    vi.mocked(isValidAgentSharedSecret).mockReturnValue(false);
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentInternalRoutes(app, { orchestrator: makeOrchestratorStub() as never });
    const { req, res, status, json } = makeReqRes({ authority: authorityBody, action: actionBody, residentApprovalGranted: false });
    await handlers.get("/api/internal/marketplace-payments/authorizations/evaluate")!(req, res, vi.fn());
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: "MARKETPLACE_PAYMENTS_INTERNAL_UNAUTHORIZED" }));
  });

  it("fails closed with 401 when the authenticated user is not an admin", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "user" } as never);
    vi.mocked(isValidAgentSharedSecret).mockReturnValue(false);
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentInternalRoutes(app, { orchestrator: makeOrchestratorStub() as never });
    const { req, res, status } = makeReqRes({ authority: authorityBody, action: actionBody, residentApprovalGranted: false });
    await handlers.get("/api/internal/marketplace-payments/authorizations/evaluate")!(req, res, vi.fn());
    expect(status).toHaveBeenCalledWith(401);
  });

  it("allows the request through an admin session", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const orchestrator = makeOrchestratorStub();
    orchestrator.evaluateAuthorizationRequest.mockReturnValue({ allowed: true, state: "authorization_required", reasons: [] });
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentInternalRoutes(app, { orchestrator: orchestrator as never });
    const { req, res, status, json } = makeReqRes({ authority: authorityBody, action: actionBody, residentApprovalGranted: false });
    await handlers.get("/api/internal/marketplace-payments/authorizations/evaluate")!(req, res, vi.fn());
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ decision: { allowed: true, state: "authorization_required", reasons: [] } });
  });

  it("allows the request through the internal agent shared secret without a session", async () => {
    vi.mocked(isValidAgentSharedSecret).mockReturnValue(true);
    const orchestrator = makeOrchestratorStub();
    orchestrator.evaluateAuthorizationRequest.mockReturnValue({ allowed: true, state: "authorization_required", reasons: [] });
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentInternalRoutes(app, { orchestrator: orchestrator as never });
    const { req, res, status } = makeReqRes(
      { authority: authorityBody, action: actionBody, residentApprovalGranted: false },
      { "x-agent-shared-secret": "secret" },
    );
    await handlers.get("/api/internal/marketplace-payments/authorizations/evaluate")!(req, res, vi.fn());
    expect(status).toHaveBeenCalledWith(200);
    expect(sdk.authenticateRequest).not.toHaveBeenCalled();
  });
});

describe("Marketplace payment internal routes — authorization", () => {
  it("returns policy denial reasons for a revoked authority grant", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const orchestrator = makeOrchestratorStub();
    orchestrator.evaluateAuthorizationRequest.mockReturnValue({
      allowed: false, state: "cancelled", reasons: ["authority_not_active"],
    });
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentInternalRoutes(app, { orchestrator: orchestrator as never });
    const { req, res, json } = makeReqRes({
      authority: { ...authorityBody, status: "revoked" }, action: actionBody, residentApprovalGranted: false,
    });
    await handlers.get("/api/internal/marketplace-payments/authorizations/evaluate")!(req, res, vi.fn());
    expect(json).toHaveBeenCalledWith({ decision: { allowed: false, state: "cancelled", reasons: ["authority_not_active"] } });
  });

  it("reports disabled live-execution status when MARKETPLACE_PAYMENTS_ENABLED is unset, via the create route", async () => {
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const orchestrator = makeOrchestratorStub();
    orchestrator.evaluateAndCreateAuthorization.mockResolvedValue({
      authorizationId: "auth-1",
      decision: { allowed: true, state: "authorization_required", reasons: [] },
      liveExecutionStatus: "disabled",
    });
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentInternalRoutes(app, { orchestrator: orchestrator as never });
    const { req, res, json } = makeReqRes({
      authority: authorityBody, action: actionBody, residentApprovalGranted: false,
      guestReadinessPlanItemId: "item-1", authorityGrantId: "grant-1", tenantId: "default",
      bldgUserId: 1, buildingSlug: "opusla",
    });
    await handlers.get("/api/internal/marketplace-payments/authorizations")!(req, res, vi.fn());
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ liveExecutionStatus: "disabled" }));
  });

  it("rejects a malformed body with 400 before reaching the orchestrator", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const orchestrator = makeOrchestratorStub();
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentInternalRoutes(app, { orchestrator: orchestrator as never });
    const { req, res, status } = makeReqRes({ authority: {}, action: {} });
    await handlers.get("/api/internal/marketplace-payments/authorizations/evaluate")!(req, res, vi.fn());
    expect(status).toHaveBeenCalledWith(400);
    expect(orchestrator.evaluateAuthorizationRequest).not.toHaveBeenCalled();
  });
});

describe("Marketplace payment internal routes — capture", () => {
  it("denies capture readiness without provider acceptance", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const orchestrator = makeOrchestratorStub();
    orchestrator.evaluateCaptureReadiness.mockReturnValue({
      allowed: false, reasons: ["acceptance_not_finalized", "no_provider_acceptance_or_verified_booking"],
    });
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentInternalRoutes(app, { orchestrator: orchestrator as never });
    const { req, res, json } = makeReqRes({
      authorizationState: "authorized",
      acceptance: { ...acceptanceBody, acceptanceStatus: "offered" },
      budgetCapCents: 30_000,
      planDeadlineAt: "2026-06-22T12:00:00.000Z",
    });
    await handlers.get("/api/internal/marketplace-payments/captures/evaluate")!(req, res, vi.fn());
    expect(json).toHaveBeenCalledWith({
      decision: { allowed: false, reasons: ["acceptance_not_finalized", "no_provider_acceptance_or_verified_booking"] },
    });
  });

  it("refuses to create a capture record when the orchestrator denies it (authorization not authorized)", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const orchestrator = makeOrchestratorStub();
    orchestrator.evaluateAndCreateCapture.mockResolvedValue({
      captureId: null,
      decision: { allowed: false, reasons: ["authorization_not_in_authorized_state"] },
      liveExecutionStatus: "not_applicable",
    });
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentInternalRoutes(app, { orchestrator: orchestrator as never });
    const { req, res, json } = makeReqRes({
      authorizationId: "auth-1", authorizationState: "authorization_pending", acceptance: acceptanceBody,
      budgetCapCents: 30_000, planDeadlineAt: "2026-06-22T12:00:00.000Z",
    });
    await handlers.get("/api/internal/marketplace-payments/captures")!(req, res, vi.fn());
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ captureId: null }));
  });

  it("the route module never imports any live-Stripe-calling adapter function", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "marketplacePaymentInternalRoute.ts"), "utf8",
    );
    expect(source).not.toMatch(/createAuthorizationPaymentIntent|captureAuthorizedPaymentIntent|createVendorTransfer|stripe\.\w+\.(create|capture)/);
  });
});
