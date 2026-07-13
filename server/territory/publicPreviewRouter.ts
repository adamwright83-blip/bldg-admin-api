import { nanoid } from "nanoid";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  dayforgeTerritoryProcedure,
  publicProcedure,
  router,
} from "../_core/trpc";
import { persistTerritoryScan } from "./territoryStore";
import { resolvePublicPreviewProvider } from "./publicPreviewProvider";
import type { TerritoryBusinessProvider } from "./territoryDiscovery";
import {
  createPublicPreviewToken,
  hashPublicPreviewFingerprint,
  hashPublicPreviewToken,
  readPublicPreviewBearerToken,
  resolvePublicPreviewClientIp,
} from "./publicPreviewSecurity";
import {
  createPublicPreviewService,
  PublicPreviewAccessError,
  PublicPreviewRateLimitError,
  type PublicPreviewServiceDependencies,
} from "./publicPreviewService";
import {
  createMissionFromPublicPreview,
  publicPreviewRepository,
} from "./publicPreviewStore";

const attributionInput = z
  .object({
    source: z.string().trim().min(1).max(96).optional(),
    medium: z.string().trim().min(1).max(96).optional(),
    campaign: z.string().trim().min(1).max(96).optional(),
    content: z.string().trim().min(1).max(96).optional(),
    placement: z.string().trim().min(1).max(96).optional(),
  })
  .strict();

const sessionInput = z.object({
  sessionId: z.string().trim().min(16).max(64),
  token: z.string().trim().min(32).max(256).optional(),
});

const candidateInput = sessionInput.extend({
  candidateKey: z.string().trim().min(3).max(191),
});

function boundedEnvNumber(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
) {
  const value = Number(process.env[name] ?? "");
  return Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function publicOperator() {
  return {
    tenantId: "public-preview",
    serviceRadiusMiles: boundedEnvNumber(
      "TERRITORY_PREVIEW_RADIUS_MILES",
      3,
      0.1,
      50
    ),
    commercialWashFoldEnabled: true,
    averagePricePerPoundCents: boundedEnvNumber(
      "TERRITORY_PREVIEW_PRICE_PER_POUND_CENTS",
      250,
      1,
      100_000
    ),
    availableWeeklyCapacityPounds: boundedEnvNumber(
      "TERRITORY_PREVIEW_CAPACITY_POUNDS",
      600,
      0,
      1_000_000
    ),
    routePoints: [],
    turnaroundCompatibleByDefault: true,
    pickupDaysCompatibleByDefault: true,
  };
}

const nonExecutingProvider: TerritoryBusinessProvider = {
  name: "unresolved",
  async geocode() {
    throw new Error("Territory provider was not resolved for execution");
  },
  async searchBusinesses() {
    throw new Error("Territory provider was not resolved for execution");
  },
};

function service(provider: TerritoryBusinessProvider = nonExecutingProvider) {
  return createPublicPreviewService({
    repository: publicPreviewRepository,
    provider,
    operator: publicOperator(),
    persistScan: ({ addressQuery, result }) =>
      persistTerritoryScan({
        tenantId: null,
        mode: "public_preview",
        addressQuery,
        createdBy: null,
        result,
      }),
    createMission: createMissionFromPublicPreview,
  } satisfies PublicPreviewServiceDependencies);
}

function bearerToken(
  token: string | undefined,
  authorization: string | string[] | undefined
): string {
  const value = readPublicPreviewBearerToken({
    explicitToken: token,
    authorization,
  });
  if (!value) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Territory preview token is required",
    });
  }
  return value;
}

function throwPublicPreviewError(error: unknown, res: { setHeader(name: string, value: string): unknown }): never {
  if (error instanceof PublicPreviewRateLimitError) {
    res.setHeader("Retry-After", String(error.retryAfterSeconds));
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: error.message,
    });
  }
  if (error instanceof PublicPreviewAccessError) {
    const code =
      error.code === "OTHER_TENANT"
        ? "FORBIDDEN"
        : error.code === "NOT_FOUND"
          ? "NOT_FOUND"
          : error.code === "EXPIRED"
            ? "NOT_FOUND"
            : "CONFLICT";
    throw new TRPCError({ code, message: error.message });
  }
  throw error;
}

async function withPreviewErrors<T>(
  res: { setHeader(name: string, value: string): unknown },
  action: () => Promise<T>
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    return throwPublicPreviewError(error, res);
  }
}

export const publicTerritoryRouter = router({
  start: publicProcedure
    .input(
      z.object({
        address: z.string().trim().min(5).max(512),
        attribution: attributionInput.optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      withPreviewErrors(ctx.res, async () => {
        const sessionId = nanoid(24);
        const { token, tokenHash } = createPublicPreviewToken();
        const ip = resolvePublicPreviewClientIp(ctx.req);
        const result = await service().start({
          sessionId,
          tokenHash,
          ipHash: hashPublicPreviewFingerprint(ip),
          address: input.address,
          attribution: input.attribution,
        });
        return { ...result, token };
      })
    ),

  execute: publicProcedure
    .input(sessionInput)
    .mutation(({ ctx, input }) =>
      withPreviewErrors(ctx.res, () => {
        const token = bearerToken(input.token, ctx.req.headers.authorization);
        return service(resolvePublicPreviewProvider()).execute({
          sessionId: input.sessionId,
          tokenHash: hashPublicPreviewToken(token),
        });
      })
    ),

  // Mutation keeps the bearer token in the POST body instead of a tRPC GET URL,
  // where reverse proxies and analytics commonly retain query strings.
  status: publicProcedure.input(sessionInput).mutation(({ ctx, input }) =>
    withPreviewErrors(ctx.res, () => {
      const token = bearerToken(input.token, ctx.req.headers.authorization);
      return service().status({
        sessionId: input.sessionId,
        tokenHash: hashPublicPreviewToken(token),
      });
    })
  ),

  openOpportunity: publicProcedure
    .input(candidateInput)
    .mutation(({ ctx, input }) =>
      withPreviewErrors(ctx.res, () => {
        const token = bearerToken(input.token, ctx.req.headers.authorization);
        return service().openOpportunity({
          sessionId: input.sessionId,
          tokenHash: hashPublicPreviewToken(token),
          candidateKey: input.candidateKey,
        });
      })
    ),

  createSampleMission: publicProcedure
    .input(candidateInput)
    .mutation(({ ctx, input }) =>
      withPreviewErrors(ctx.res, () => {
        const token = bearerToken(input.token, ctx.req.headers.authorization);
        return service().createSampleMission({
          sessionId: input.sessionId,
          tokenHash: hashPublicPreviewToken(token),
          candidateKey: input.candidateKey,
        });
      })
    ),

  convertPreview: dayforgeTerritoryProcedure
    .input(
      candidateInput.extend({
        assignedTo: z.string().trim().min(1).max(128).nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      withPreviewErrors(ctx.res, () => {
        const token = bearerToken(input.token, ctx.req.headers.authorization);
        return service().convert({
          sessionId: input.sessionId,
          tokenHash: hashPublicPreviewToken(token),
          candidateKey: input.candidateKey,
          tenantId: ctx.tenantId,
          actorId: ctx.user.openId,
          assignedTo: input.assignedTo,
        });
      })
    ),
});
