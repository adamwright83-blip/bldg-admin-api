import crypto from "node:crypto";
import type express from "express";
import { createProcurementPool } from "./migrations";
import { ResidentProposalReadStore } from "./residentProposalReadStore";
import { ResidentProposalConsentStore } from "./residentProposalConsentStore";

type ReadStore = Pick<ResidentProposalReadStore, "listVisible" | "readOwned">;
type ConsentStore = Pick<ResidentProposalConsentStore, "recordConsent">;
type ResidentIdentity = { bldgUserId: number; tenantId: string };

function header(req: express.Request, name: string): string | null {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() || null;
}

/** The resident app must derive this identity from its authenticated bldg_session, never resident-controlled input. */
export function authenticateResidentAppRequest(req: express.Request): ResidentIdentity | null {
  const expected = process.env.APP_SHARED_API_SECRET;
  if (!expected || header(req, "x-app-shared-secret") !== expected) return null;
  if (header(req, "x-resident-session-verified") !== "true") return null;
  const id = Number(header(req, "x-bldg-user-id"));
  const tenantId = header(req, "x-tenant-id");
  if (!Number.isSafeInteger(id) || id <= 0 || !tenantId) return null;
  return { bldgUserId: id, tenantId };
}

export function createResidentProposalReadHandlers(store: ReadStore) {
  return {
    list: async (req: express.Request, res: express.Response) => {
      const resident = authenticateResidentAppRequest(req);
      if (!resident) return res.status(401).json({ error: "Unauthorized" });
      const limit = Math.max(1, Math.min(20, Number(req.query.limit) || 10));
      const offset = Math.max(0, Math.min(1000, Number(req.query.offset) || 0));
      return res.json(await store.listVisible({ ...resident, limit, offset }));
    },
    get: async (req: express.Request, res: express.Response) => {
      const resident = authenticateResidentAppRequest(req);
      if (!resident) return res.status(401).json({ error: "Unauthorized" });
      const card = await store.readOwned({ ...resident, versionId: req.params.versionId });
      if (!card) return res.status(404).json({ error: "Proposal not found" });
      return res.json(card);
    },
  };
}

export function registerResidentProposalReadRoutes(app: express.Express, injected?: ReadStore): void {
  const store = injected ?? new ResidentProposalReadStore(createProcurementPool());
  const handlers = createResidentProposalReadHandlers(store);
  app.get("/api/resident/proposals", handlers.list);
  app.get("/api/resident/proposals/:versionId", handlers.get);
}

const VALID_VERSION_ID = /^[A-Za-z0-9_-]{1,191}$/;

export function createResidentProposalConsentHandler(store: ConsentStore) {
  return async (req: express.Request, res: express.Response) => {
    const resident = authenticateResidentAppRequest(req);
    if (!resident) return res.status(401).json({ error: "Unauthorized" });

    const versionId = req.params.versionId;
    if (!versionId || !VALID_VERSION_ID.test(versionId)) {
      return res.status(400).json({ error: "Invalid proposal version id" });
    }

    const { decision, record } = await store.recordConsent({
      id: crypto.randomUUID(), versionId, bldgUserId: resident.bldgUserId, tenantId: resident.tenantId,
      createdBy: `bldg_user:${resident.bldgUserId}`,
    });

    if (decision.outcome === "invalid_request") {
      return res.status(400).json({ error: "Invalid request" });
    }
    if (decision.outcome === "consent_not_allowed") {
      return res.status(404).json({ error: "Proposal not found" });
    }
    return res.status(decision.outcome === "consent_already_recorded" ? 200 : 201).json({
      status: decision.outcome, proposalVersionId: record?.proposalVersionId,
      consentAction: record?.consentAction, consentedAt: record?.consentedAt,
    });
  };
}

export function registerResidentProposalConsentRoute(app: express.Express, injected?: ConsentStore): void {
  const store = injected ?? new ResidentProposalConsentStore(createProcurementPool());
  app.post("/api/resident/proposals/:versionId/consent", createResidentProposalConsentHandler(store));
}
