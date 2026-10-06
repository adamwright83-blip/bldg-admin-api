import express, { type Request, type Response, type Router } from "express";
import type { AdamIdentity } from "./cycleService";
import {
  approveFinalSet,
  declineAll,
  createApprovedMissions,
  type MissionPolicy,
} from "./cycleService";
import { getForTenant, type CycleStore } from "./cycleStore";
import type { Cycle } from "../../../shared/presidentCycle";

type Awaitable<T> = T | Promise<T>;

/**
 * Authenticated founder review surface. Identity and tenant are derived from the
 * server-side session resolver, NEVER from request JSON.
 */
export function createPresidentCycleRouter(deps: {
  store: CycleStore;
  resolveAdam: (req: Request) => Awaitable<AdamIdentity | null>;
  resolveTenant: (req: Request) => Awaitable<string | null>;
  missionPolicy: MissionPolicy;
  startCycle?: (tenantId: string) => Promise<Cycle>;
  readiness?: () => Promise<unknown>;
  afterApproval?: (cycleId: string) => Awaitable<void>;
  allowMutation?: (req: Request) => boolean;
}): Router {
  const r = express.Router();
  r.use(express.json());
  r.use((req, res, next) => {
    if (
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      deps.allowMutation &&
      !deps.allowMutation(req)
    ) {
      res.status(403).json({ error: "Invalid request origin" });
      return;
    }
    next();
  });

  const auth = async (req: Request, res: Response) => {
    const [adam, tenant] = await Promise.all([
      deps.resolveAdam(req),
      deps.resolveTenant(req),
    ]);
    if (!adam || !tenant) {
      res.status(401).json({ error: "Adam authority required" });
      return null;
    }
    return { adam, tenant };
  };

  const view = (c: NonNullable<Awaited<ReturnType<typeof getForTenant>>>) => ({
    cycleId: c.cycleId,
    status: c.status,
    proposed: c.presidentProposedIds.map(id =>
      c.finalCandidates.find(x => x.candidateId === id)
    ),
    presidentRationale: c.presidentRationale,
    evidence: c.evidence,
    approval: c.approval,
    deliberation: c.rounds.map(x => ({
      round: x.round,
      provider: x.provider,
      model: x.model,
      completedAt: x.completedAt,
    })),
    blockedReason: c.blockedReason,
    missions: c.missions.map(m => ({
      missionId: m.missionId,
      candidateId: m.candidateId,
      title: m.title,
      status: m.status,
      blocker: m.blocker,
      prUrl: m.handback?.prUrl ?? null,
      reviewVerdict: m.handback?.reviewVerdict ?? null,
    })),
  });

  if (deps.readiness) {
    r.get("/readiness", async (req, res) => {
      const a = await auth(req, res);
      if (!a) return;
      try {
        res.json(await deps.readiness!());
      } catch (error) {
        res.status(503).json({
          APP_RUNNING: true,
          PRESIDENT_AUTONOMOUS_EXECUTION_READY: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  if (deps.startCycle) {
    r.post("/cycles", async (req, res) => {
      const a = await auth(req, res);
      if (!a) return;
      try {
        const cycle = await deps.startCycle!(a.tenant);
        res.status(201).json(view(cycle));
      } catch (error) {
        res.status(503).json({
          error:
            error instanceof Error
              ? error.message
              : "President cycle could not be started",
        });
      }
    });
  }

  r.get("/cycles/:id", async (req, res) => {
    const a = await auth(req, res);
    if (!a) return;
    const c = await getForTenant(deps.store, a.tenant, req.params.id);
    return c ? res.json(view(c)) : res.status(404).json({ error: "not found" });
  });

  // "View the other 7" — the full final ranked list is always retrievable.
  r.get("/cycles/:id/others", async (req, res) => {
    const a = await auth(req, res);
    if (!a) return;
    const c = await getForTenant(deps.store, a.tenant, req.params.id);
    if (!c) return res.status(404).json({ error: "not found" });
    res.json({
      others: c.finalCandidates.filter(
        x => !c.presidentProposedIds.includes(x.candidateId)
      ),
      originalFirstRound: c.firstRoundCandidates,
      critique:
        c.rounds.find(x => x.round === "CRITIQUE")?.parsed ?? null,
    });
  });

  r.get("/cycles/:id/report", async (req, res) => {
    const a = await auth(req, res);
    if (!a) return;
    const c = await getForTenant(deps.store, a.tenant, req.params.id);
    if (!c) return res.status(404).json({ error: "not found" });
    if (!c.morningReport)
      return res.status(409).json({ error: "morning report not ready" });
    return res.json(c.morningReport);
  });

  r.post("/cycles/:id/approve", async (req, res) => {
    const a = await auth(req, res);
    if (!a) return;
    try {
      const ids = req.body?.approvedCandidateIds;
      if (
        !Array.isArray(ids) ||
        !ids.every((x: unknown) => typeof x === "string")
      )
        return res
          .status(400)
          .json({ error: "approvedCandidateIds[] required" });
      const receipt = await approveFinalSet(deps.store, {
        tenantId: a.tenant,
        cycleId: req.params.id,
        approvedCandidateIds: ids,
        approvedBy: a.adam,
      });
      await createApprovedMissions(
        deps.store,
        req.params.id,
        deps.missionPolicy
      );
      res.json({ receipt, executionQueued: true });
      if (deps.afterApproval) {
        Promise.resolve(deps.afterApproval(req.params.id)).catch(error => {
          console.error(
            "[PresidentCycle] post-approval execution kick failed",
            error
          );
        });
      }
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  });

  r.post("/cycles/:id/decline", async (req, res) => {
    const a = await auth(req, res);
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
