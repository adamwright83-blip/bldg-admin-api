import type express from "express";
import { z } from "zod";
import { createProcurementPool } from "../procurement/migrations";
import { assertAdminOrAgent, handleError } from "./marketplacePaymentInternalRoute";
import { MarketplacePaymentReadStore } from "./marketplacePaymentReadStore";

const limitOffsetSchema = z.object({
  limit: z.coerce.number().optional(),
  offset: z.coerce.number().optional(),
});

const listAuthorizationsQuerySchema = limitOffsetSchema.extend({
  guestReadinessPlanItemId: z.string().optional(),
  tenantId: z.string().optional(),
  bldgUserId: z.coerce.number().int().optional(),
  buildingSlug: z.string().optional(),
  state: z.enum([
    "no_payment_required", "authorization_required", "authorization_pending", "authorized", "cancelled",
  ]).optional(),
});

const listCapturesQuerySchema = limitOffsetSchema.extend({
  authorizationId: z.string().min(1),
});

const listVendorPayablesQuerySchema = limitOffsetSchema.extend({
  vendorId: z.coerce.number().int().optional(),
  state: z.enum(["transfer_pending", "transferred", "transfer_failed", "cancelled"]).optional(),
});

const listStripeEventsQuerySchema = limitOffsetSchema.extend({
  relatedAuthorizationId: z.string().optional(),
  processingStatus: z.enum(["received", "processed", "ignored", "failed"]).optional(),
});

const listByCaptureQuerySchema = limitOffsetSchema.extend({
  captureId: z.string().min(1),
});

const idParamSchema = z.object({ id: z.string().min(1) });
const keyParamSchema = z.object({ key: z.string().min(1) });

type ReadStoreDeps = { readStore?: MarketplacePaymentReadStore };

let lazyReadStore: MarketplacePaymentReadStore | null = null;
function resolveReadStore(deps: ReadStoreDeps): MarketplacePaymentReadStore {
  if (deps.readStore) return deps.readStore;
  if (!lazyReadStore) {
    lazyReadStore = new MarketplacePaymentReadStore(createProcurementPool());
  }
  return lazyReadStore;
}

/**
 * Internal/admin-only read API over the Slice 4 marketplace-payments
 * schema. Visibility only: every handler here calls exactly one
 * MarketplacePaymentReadStore method, which issues a `SELECT` and nothing
 * else. No handler in this file creates, updates, or deletes a row, calls
 * Stripe, enqueues a workflow step, contacts a vendor, or reads/writes a
 * feature flag.
 */
export function registerMarketplacePaymentReadRoutes(app: express.Express, deps: ReadStoreDeps = {}) {
  app.get("/api/internal/marketplace-payments/authorizations/:id", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const { id } = idParamSchema.parse(req.params);
      const store = resolveReadStore(deps);
      const record = await store.getAuthorizationById(id);
      if (!record) {
        return res.status(404).json({ error: "Not found", code: "MARKETPLACE_PAYMENTS_AUTHORIZATION_NOT_FOUND" });
      }
      return res.status(200).json({ authorization: record });
    } catch (error) {
      return handleError(res, error);
    }
  });

  app.get("/api/internal/marketplace-payments/authorizations", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const query = listAuthorizationsQuerySchema.parse(req.query ?? {});
      const store = resolveReadStore(deps);
      const result = await store.listAuthorizations(query);
      return res.status(200).json(result);
    } catch (error) {
      return handleError(res, error);
    }
  });

  app.get("/api/internal/marketplace-payments/captures/:id", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const { id } = idParamSchema.parse(req.params);
      const store = resolveReadStore(deps);
      const record = await store.getCaptureById(id);
      if (!record) {
        return res.status(404).json({ error: "Not found", code: "MARKETPLACE_PAYMENTS_CAPTURE_NOT_FOUND" });
      }
      return res.status(200).json({ capture: record });
    } catch (error) {
      return handleError(res, error);
    }
  });

  app.get("/api/internal/marketplace-payments/captures", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const query = listCapturesQuerySchema.parse(req.query ?? {});
      const store = resolveReadStore(deps);
      const result = await store.listCapturesByAuthorization(query.authorizationId, {
        limit: query.limit, offset: query.offset,
      });
      return res.status(200).json(result);
    } catch (error) {
      return handleError(res, error);
    }
  });

  app.get("/api/internal/marketplace-payments/vendor-payables", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const query = listVendorPayablesQuerySchema.parse(req.query ?? {});
      const store = resolveReadStore(deps);
      const result = await store.listVendorPayables(query);
      return res.status(200).json(result);
    } catch (error) {
      return handleError(res, error);
    }
  });

  app.get("/api/internal/marketplace-payments/stripe-events", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const query = listStripeEventsQuerySchema.parse(req.query ?? {});
      const store = resolveReadStore(deps);
      const result = await store.listStripeEvents(query);
      return res.status(200).json(result);
    } catch (error) {
      return handleError(res, error);
    }
  });

  app.get("/api/internal/marketplace-payments/refunds", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const query = listByCaptureQuerySchema.parse(req.query ?? {});
      const store = resolveReadStore(deps);
      const result = await store.listRefundsByCapture(query.captureId, { limit: query.limit, offset: query.offset });
      return res.status(200).json(result);
    } catch (error) {
      return handleError(res, error);
    }
  });

  app.get("/api/internal/marketplace-payments/disputes", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const query = listByCaptureQuerySchema.parse(req.query ?? {});
      const store = resolveReadStore(deps);
      const result = await store.listDisputesByCapture(query.captureId, { limit: query.limit, offset: query.offset });
      return res.status(200).json(result);
    } catch (error) {
      return handleError(res, error);
    }
  });

  app.get("/api/internal/marketplace-payments/idempotency-keys/:key", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const { key } = keyParamSchema.parse(req.params);
      const store = resolveReadStore(deps);
      const record = await store.getIdempotencyKeyMetadata(key);
      if (!record) {
        return res.status(404).json({ error: "Not found", code: "MARKETPLACE_PAYMENTS_IDEMPOTENCY_KEY_NOT_FOUND" });
      }
      return res.status(200).json({ idempotencyKey: record });
    } catch (error) {
      return handleError(res, error);
    }
  });
}
