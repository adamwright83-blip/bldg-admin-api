import express, { type Request, type Response, type Router } from "express";
import type { AdamIdentity } from "./cycleService";
import { approveFinalSet, declineAll, createApprovedMissions, type MissionPolicy } from "./cycleService";
import { getForTenant, type CycleStore } from "./cycleStore";

/**
 * Review surface for Adam. Not mounted by this branch (server/_core/index.ts is a
 * shared file); see docs/PRESIDENT_RECONCILIATION.md. Identity and tenant come from
 * injected authenticated-session resolvers, NEVER from the request body.
 */
export function createPresidentCycleRouter(deps: {
  store: CycleStore;
  resolveAdam: (req: Request) => AdamIdentity | null;
  resolveTenant: (req: Request) => string | null;
  missionPolicy: MissionPolicy;
}): Router {
  const r = express.Router();
  r.use(express.json());

  const auth = (req: Request, res: Response) => {
    const adam = deps.resolveAdam(req);
    const tenant = deps.resolveTenant(req);
    if (!adam || !tenant) {
      res.status(401).json({ error: "Adam authority required" });
      return null;
    }
    return { adam, tenant };
  };

  const view = (c: NonNullable<Awaited<ReturnType<typeof getForTenant>>>) => ({
    cycleId: c.cycleId,
    status: c.status,
    proposed: c.presidentProposedIds.map(id => c.finalCandidates.find(x => x.candidateId === id)),
    presidentRationale: c.presidentRationale,
    evidence: c.evidence,
    approval: c.approval,
    deliberation: c.rounds.map(x => ({ round: x.round, provider: x.provider, model: x.model, completedAt: x.completedAt })),
  });

  r.get("/cycles/:id", async (req, res) => {
    const a = auth(req, res);
    if (!a) return;
    const c = await getForTenant(deps.store, a.tenant, req.params.id);
    return c ? res.json(view(c)) : res.status(404).json({ error: "not found" });
  });

  // "View the other 7" — the full final ranked list is always retrievable.
  r.get("/cycles/:id/others", async (req, res) => {
    const a = auth(req, res);
    if (!a) return;
    const c = await getForTenant(deps.store, a.tenant, req.params.id);
    if (!c) return res.status(404).json({ error: "not found" });
    res.json({
      others: c.finalCandidates.filter(x => !c.presidentProposedIds.includes(x.candidateId)),
      originalFirstRound: c.firstRoundCandidates,
      critique: c.rounds.find(x => x.round === "CRITIQUE")?.parsed ?? null,
    });
  });

  r.post("/cycles/:id/approve", async (req, res) => {
    const a = auth(req, res);
    if (!a) return;
    try {
      const ids = req.body?.approvedCandidateIds;
      if (!Array.isArray(ids) || !ids.every((x: unknown) => typeof x === "string"))
        return res.status(400).json({ error: "approvedCandidateIds[] required" });
      const receipt = await approveFinalSet(deps.store, {
        tenantId: a.tenant,
        cycleId: req.params.id,
        approvedCandidateIds: ids,
        approvedBy: a.adam,
      });
      await createApprovedMissions(deps.store, req.params.id, deps.missionPolicy);
      res.json({ receipt });
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  });

  r.post("/cycles/:id/decline", async (req, res) => {
    const a = auth(req, res);
    if (!a) return;
    try {
      await declineAll(deps.store, a.tenant, req.params.id, a.adam);
      res.json({ ok: true });
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  });
  return r;
}
