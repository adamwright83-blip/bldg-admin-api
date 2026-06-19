import type express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../_core/sdk", () => ({ sdk: { authenticateRequest: vi.fn() } }));
vi.mock("../agents/s2sEndpoint", () => ({ isValidAgentSharedSecret: vi.fn().mockReturnValue(false) }));
vi.mock("../procurement/migrations", () => ({
  createProcurementPool: vi.fn(() => {
    throw new Error("createProcurementPool should never be called by the dry-run route");
  }),
}));

const { sdk } = await import("../_core/sdk");
const { registerMarketplacePaymentDryRunRoutes } = await import("./marketplacePaymentDryRunRoute");

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

const ROUTE = "/api/internal/marketplace-payments/dry-run";

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

describe("Marketplace payment dry-run route", () => {
  it("fails closed with 401 when neither admin session nor agent shared secret is present", async () => {
    vi.mocked(sdk.authenticateRequest).mockRejectedValue(new Error("no session"));
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentDryRunRoutes(app);
    const { req, res, status } = makeReqRes({});
    await handlers.get(ROUTE)!(req, res, vi.fn());
    expect(status).toHaveBeenCalledWith(401);
  });

  it("reports flags off/unset by default for an authenticated admin", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentDryRunRoutes(app);
    const { req, res, json } = makeReqRes({});
    await handlers.get(ROUTE)!(req, res, vi.fn());
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      flags: expect.objectContaining({ marketplacePaymentsEnabled: false, liveStripeBlocked: true }),
      overallStatus: "not_evaluated",
    }));
  });

  it("denies capture without provider acceptance, surfaced through the route", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentDryRunRoutes(app);
    const { req, res, json } = makeReqRes({
      capture: {
        authorizationState: "authorized",
        acceptance: { ...acceptanceBody, acceptanceStatus: "offered" },
        budgetCapCents: 30_000,
        planDeadlineAt: "2026-06-22T12:00:00.000Z",
      },
    });
    await handlers.get(ROUTE)!(req, res, vi.fn());
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      capture: expect.objectContaining({ decision: expect.objectContaining({ allowed: false }) }),
      overallStatus: "blocked_by_policy",
    }));
  });

  it("denies capture unless authorization is authorized, surfaced through the route", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentDryRunRoutes(app);
    const { req, res, json } = makeReqRes({
      capture: {
        authorizationState: "authorization_pending",
        acceptance: acceptanceBody,
        budgetCapCents: 30_000,
        planDeadlineAt: "2026-06-22T12:00:00.000Z",
      },
    });
    await handlers.get(ROUTE)!(req, res, vi.fn());
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      capture: expect.objectContaining({
        decision: expect.objectContaining({ allowed: false, reasons: expect.arrayContaining(["authorization_not_in_authorized_state"]) }),
      }),
    }));
  });

  it("reports simulated readiness only when every gate passes and the live-payments flag is on", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "true";
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentDryRunRoutes(app);
    const { req, res, json } = makeReqRes({
      authorization: { authority: authorityBody, action: actionBody, residentApprovalGranted: false },
      capture: {
        authorizationState: "authorized", acceptance: acceptanceBody,
        budgetCapCents: 30_000, planDeadlineAt: "2026-06-22T12:00:00.000Z",
      },
    });
    await handlers.get(ROUTE)!(req, res, vi.fn());
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ overallStatus: "ready" }));
  });

  it("rejects a malformed body with 400 before evaluating anything", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentDryRunRoutes(app);
    const { req, res, status } = makeReqRes({ authorization: { authority: {} } });
    await handlers.get(ROUTE)!(req, res, vi.fn());
    expect(status).toHaveBeenCalledWith(400);
  });
});

describe("Slice 9 route safety", () => {
  it("the dry-run route module never imports a store, the orchestrator, or Stripe", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "marketplacePaymentDryRunRoute.ts"), "utf8");
    const importLines = source.split("\n").filter(line => line.trim().startsWith("import"));
    expect(importLines.join("\n")).not.toMatch(
      /MarketplacePaymentStore|MarketplacePaymentOrchestrator|createProcurementPool|["']stripe["']/,
    );
  });
});
