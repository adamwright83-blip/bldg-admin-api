import { createHash } from "node:crypto";
import type { Express, Request } from "express";
import { ENV } from "../../_core/env";
import { sdk } from "../../_core/sdk";
import { resolveTenantIdFromHeaders } from "../../../shared/tenantConfig";
import {
  isPlatformAdministrator,
  tenantForAuthenticatedUser,
} from "../../platform/tenancy/tenantIdentity";
import { assertTrpcMutationOrigin } from "../../legacyDayforgeSecurity/legacyDayforgeSecurity";
import { createPresidentCycleRouter } from "./api";
import type { CycleStore } from "./cycleStore";
import {
  getPresidentCycleStore,
  presidentCycleReadiness,
  queuePresidentRecommendationCycle,
  runPresidentApprovedCycle,
} from "./runtime";

function sessionRef(req: Request, openId: string) {
  const source =
    req.headers.cookie ||
    req.headers.authorization ||
    `openId:${openId}`;
  return (
    "session_sha256:" +
    createHash("sha256").update(String(source)).digest("hex").slice(0, 24)
  );
}

async function authenticatedFounder(req: Request) {
  let user: Awaited<ReturnType<typeof sdk.authenticateRequest>> | null = null;
  try {
    user = await sdk.authenticateRequest(req);
  } catch {
    user = null;
  }
  if (
    !user ||
    !ENV.ownerOpenId ||
    user.openId !== ENV.ownerOpenId ||
    !isPlatformAdministrator(user)
  )
    return null;
  return user;
}

async function authority(req: Request) {
  const user = await authenticatedFounder(req);
  if (!user) return null;
  const host = resolveTenantIdFromHeaders(
    req.headers as Record<string, string | string[] | undefined>
  ).tenantId;
  const tenant = tenantForAuthenticatedUser({
    user: {
      openId: user.openId,
      role: user.role,
      tenantId: user.tenantId,
    },
    hostTenantId: host,
  });
  if (tenant.denial) return null;
  return {
    tenantId: tenant.tenantId,
    adam: {
      identity: user.openId,
      mechanism: "authenticated-founder-session",
      sessionRef: sessionRef(req, user.openId),
    },
  };
}

/** Lazy wrapper: app boot does not require the President database/table. */
const lazyStore: CycleStore = {
  get: id => getPresidentCycleStore().get(id),
  create: cycle => getPresidentCycleStore().create(cycle),
  update: (id, fn) => getPresidentCycleStore().update(id, fn),
  list: tenantId => getPresidentCycleStore().list(tenantId),
};

export function registerPresidentCycleHttpRoutes(app: Express) {
  const router = createPresidentCycleRouter({
    store: lazyStore,
    resolveAdam: async req => (await authority(req))?.adam ?? null,
    resolveTenant: async req => (await authority(req))?.tenantId ?? null,
    missionPolicy: {
      defaultCommands: { ENGINEERING: ["pnpm check"] },
      maxAttempts: 3,
    },
    startCycle: tenantId =>
      queuePresidentRecommendationCycle({
        tenantId,
      }),
    readiness: presidentCycleReadiness,
    afterApproval: async cycleId => {
      if (
        process.env.PRESIDENT_EXECUTION_ENABLED === "1" &&
        process.env.PRESIDENT_INLINE_EXECUTION === "1"
      )
        await runPresidentApprovedCycle(cycleId);
    },
    allowMutation: req =>
      assertTrpcMutationOrigin({ req, isMutation: true }).allowed,
  });
  app.use("/api/president/autonomous", router);
}
