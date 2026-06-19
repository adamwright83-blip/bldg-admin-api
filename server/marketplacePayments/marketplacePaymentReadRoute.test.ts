import type express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../_core/sdk", () => ({ sdk: { authenticateRequest: vi.fn() } }));
vi.mock("../agents/s2sEndpoint", () => ({ isValidAgentSharedSecret: vi.fn().mockReturnValue(false) }));
vi.mock("../procurement/migrations", () => ({
  createProcurementPool: vi.fn(() => {
    throw new Error("createProcurementPool should never be called when a readStore is injected for tests");
  }),
}));

const { sdk } = await import("../_core/sdk");
const { registerMarketplacePaymentReadRoutes } = await import("./marketplacePaymentReadRoute");

afterEach(() => {
  vi.clearAllMocks();
});

function makeFakeApp() {
  const handlers = new Map<string, express.RequestHandler>();
  const app = { get: (path: string, handler: express.RequestHandler) => { handlers.set(path, handler); } };
  return { app: app as unknown as express.Express, handlers };
}

function makeReqRes(query: Record<string, unknown> = {}, params: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const req = { query, params, headers } as unknown as express.Request;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status } as unknown as express.Response;
  return { req, res, status, json };
}

function makeReadStoreStub() {
  return {
    getAuthorizationById: vi.fn(),
    listAuthorizations: vi.fn(),
    getCaptureById: vi.fn(),
    listCapturesByAuthorization: vi.fn(),
    listVendorPayables: vi.fn(),
    listStripeEvents: vi.fn(),
    listRefundsByCapture: vi.fn(),
    listDisputesByCapture: vi.fn(),
    getIdempotencyKeyMetadata: vi.fn(),
  };
}

describe("Marketplace payment read routes — auth guard", () => {
  it("fails closed with 401 when neither admin session nor agent shared secret is present, for every route", async () => {
    vi.mocked(sdk.authenticateRequest).mockRejectedValue(new Error("no session"));
    const readStore = makeReadStoreStub();
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentReadRoutes(app, { readStore: readStore as never });
    const paths = [
      "/api/internal/marketplace-payments/authorizations/:id",
      "/api/internal/marketplace-payments/authorizations",
      "/api/internal/marketplace-payments/captures/:id",
      "/api/internal/marketplace-payments/captures",
      "/api/internal/marketplace-payments/vendor-payables",
      "/api/internal/marketplace-payments/stripe-events",
      "/api/internal/marketplace-payments/refunds",
      "/api/internal/marketplace-payments/disputes",
      "/api/internal/marketplace-payments/idempotency-keys/:key",
    ];
    for (const path of paths) {
      const { req, res, status } = makeReqRes({ authorizationId: "a", captureId: "c" }, { id: "x", key: "x" });
      await handlers.get(path)!(req, res, vi.fn());
      expect(status).toHaveBeenCalledWith(401);
    }
    for (const method of Object.values(readStore)) expect(method).not.toHaveBeenCalled();
  });

  it("allows the request through an admin session", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const readStore = makeReadStoreStub();
    readStore.getAuthorizationById.mockResolvedValue({ id: "auth-1", state: "authorized" });
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentReadRoutes(app, { readStore: readStore as never });
    const { req, res, status, json } = makeReqRes({}, { id: "auth-1" });
    await handlers.get("/api/internal/marketplace-payments/authorizations/:id")!(req, res, vi.fn());
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ authorization: { id: "auth-1", state: "authorized" } });
  });
});

describe("Marketplace payment read routes — reads", () => {
  it("GET authorization by id returns 404 when the store returns null", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const readStore = makeReadStoreStub();
    readStore.getAuthorizationById.mockResolvedValue(null);
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentReadRoutes(app, { readStore: readStore as never });
    const { req, res, status } = makeReqRes({}, { id: "missing" });
    await handlers.get("/api/internal/marketplace-payments/authorizations/:id")!(req, res, vi.fn());
    expect(status).toHaveBeenCalledWith(404);
  });

  it("list authorizations passes through query filters to the store and returns its result", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const readStore = makeReadStoreStub();
    readStore.listAuthorizations.mockResolvedValue({ items: [{ id: "auth-1" }], limit: 50, offset: 0 });
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentReadRoutes(app, { readStore: readStore as never });
    const { req, res, json } = makeReqRes({ tenantId: "default", state: "authorized" });
    await handlers.get("/api/internal/marketplace-payments/authorizations")!(req, res, vi.fn());
    expect(readStore.listAuthorizations).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "default", state: "authorized" }),
    );
    expect(json).toHaveBeenCalledWith({ items: [{ id: "auth-1" }], limit: 50, offset: 0 });
  });

  it("list captures requires authorizationId and returns 400 when missing", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const readStore = makeReadStoreStub();
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentReadRoutes(app, { readStore: readStore as never });
    const { req, res, status } = makeReqRes({});
    await handlers.get("/api/internal/marketplace-payments/captures")!(req, res, vi.fn());
    expect(status).toHaveBeenCalledWith(400);
    expect(readStore.listCapturesByAuthorization).not.toHaveBeenCalled();
  });

  it("list captures forwards limit/offset to the store unchanged (clamping happens in the store itself)", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const readStore = makeReadStoreStub();
    readStore.listCapturesByAuthorization.mockResolvedValue({ items: [], limit: 50, offset: 0 });
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentReadRoutes(app, { readStore: readStore as never });
    const { req, res } = makeReqRes({ authorizationId: "auth-1", limit: "999999", offset: "-5" });
    await handlers.get("/api/internal/marketplace-payments/captures")!(req, res, vi.fn());
    expect(readStore.listCapturesByAuthorization).toHaveBeenCalledWith("auth-1", { limit: 999_999, offset: -5 });
  });

  it("a non-numeric limit query param returns 400 before the store is called", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const readStore = makeReadStoreStub();
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentReadRoutes(app, { readStore: readStore as never });
    const { req, res, status } = makeReqRes({ authorizationId: "auth-1", limit: "not-a-number" });
    await handlers.get("/api/internal/marketplace-payments/captures")!(req, res, vi.fn());
    expect(status).toHaveBeenCalledWith(400);
    expect(readStore.listCapturesByAuthorization).not.toHaveBeenCalled();
  });

  it("list vendor payables and stripe events return store results unchanged", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const readStore = makeReadStoreStub();
    readStore.listVendorPayables.mockResolvedValue({ items: [{ id: "vp-1" }], limit: 50, offset: 0 });
    readStore.listStripeEvents.mockResolvedValue({ items: [{ id: 1 }], limit: 50, offset: 0 });
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentReadRoutes(app, { readStore: readStore as never });
    const vp = makeReqRes({ vendorId: "7" });
    await handlers.get("/api/internal/marketplace-payments/vendor-payables")!(vp.req, vp.res, vi.fn());
    expect(readStore.listVendorPayables).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 7 }));
    const se = makeReqRes({ processingStatus: "failed" });
    await handlers.get("/api/internal/marketplace-payments/stripe-events")!(se.req, se.res, vi.fn());
    expect(readStore.listStripeEvents).toHaveBeenCalledWith(expect.objectContaining({ processingStatus: "failed" }));
  });

  it("list refunds and disputes require captureId and return 400 when missing", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const readStore = makeReadStoreStub();
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentReadRoutes(app, { readStore: readStore as never });
    const refunds = makeReqRes({});
    await handlers.get("/api/internal/marketplace-payments/refunds")!(refunds.req, refunds.res, vi.fn());
    expect(refunds.status).toHaveBeenCalledWith(400);
    const disputes = makeReqRes({});
    await handlers.get("/api/internal/marketplace-payments/disputes")!(disputes.req, disputes.res, vi.fn());
    expect(disputes.status).toHaveBeenCalledWith(400);
  });

  it("idempotency key metadata returns 404 when not found and 200 with the record when found", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ role: "admin" } as never);
    const readStore = makeReadStoreStub();
    readStore.getIdempotencyKeyMetadata.mockResolvedValueOnce(null).mockResolvedValueOnce({
      idempotencyKey: "key-1", operationType: "marketplace_authorization", requestPayloadHash: "key-1",
      hasStripeResponse: false, createdAt: new Date("2026-06-19T00:00:00.000Z"),
    });
    const { app, handlers } = makeFakeApp();
    registerMarketplacePaymentReadRoutes(app, { readStore: readStore as never });
    const missing = makeReqRes({}, { key: "missing" });
    await handlers.get("/api/internal/marketplace-payments/idempotency-keys/:key")!(missing.req, missing.res, vi.fn());
    expect(missing.status).toHaveBeenCalledWith(404);
    const found = makeReqRes({}, { key: "key-1" });
    await handlers.get("/api/internal/marketplace-payments/idempotency-keys/:key")!(found.req, found.res, vi.fn());
    expect(found.status).toHaveBeenCalledWith(200);
  });
});

describe("Slice 7 production-safety invariants", () => {
  const repoRoot = `${__dirname}/../..`;
  const read = async (relativePath: string) => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    return fs.readFileSync(path.resolve(repoRoot, relativePath), "utf8");
  };

  it("the read route module never imports Stripe, the orchestrator, or a write-capable store", async () => {
    const source = await read("server/marketplacePayments/marketplacePaymentReadRoute.ts");
    const importLines = source.split("\n").filter(line => line.trim().startsWith("import"));
    const importText = importLines.join("\n");
    expect(importText).not.toMatch(/MarketplacePaymentOrchestrator|MarketplacePaymentStore\b|["']stripe["']|createWorkflowWithStep|ProcurementWorkflowStore/i);
  });

  it("the read store module never issues an INSERT, UPDATE, or DELETE in its source text", async () => {
    const source = await read("server/marketplacePayments/marketplacePaymentReadStore.ts");
    expect(source).not.toMatch(/\bINSERT INTO\b|\bUPDATE\s+marketplace|\bDELETE FROM\b/i);
  });

  it("never registers a marketplace step handler in the existing procurement worker", async () => {
    expect(await read("server/procurement/worker.ts")).not.toMatch(/marketplace/i);
    expect(await read("server/procurement/workerMain.ts")).not.toMatch(/marketplace/i);
  });

  it("does not modify the legacy chargeCard / orders / Stripe destination-charge flow", async () => {
    const routersSource = await read("server/routers.ts");
    expect(routersSource).toMatch(/transfer_data:\s*{\s*destination:\s*vendorAccountId!\s*}/);
    expect(routersSource).toMatch(/application_fee_amount:\s*platformFeeCents/);
  });

  it("does not introduce any resident-facing UI code", async () => {
    const source = await read("server/marketplacePayments/marketplacePaymentReadRoute.ts");
    expect(source).not.toMatch(/from ["']react["']|useState|useEffect/);
  });
});
