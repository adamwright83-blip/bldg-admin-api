import type { CommercialMission } from "@shared/commercialMission";
import type { DayforgeProductEventName } from "@shared/dayforgeEvents";
import type { TerritoryBusinessProvider } from "./territoryDiscovery";
import {
  discoverLaundryTerritory,
  type GeoPoint,
  type LaundryTerritoryOperatorContext,
  type RankedTerritoryOpportunity,
  type TerritoryDiscoveryResult,
} from "./territoryDiscovery";
import {
  buildPublicPreviewSampleMission,
  type PublicPreviewSampleMission,
} from "./publicPreviewMission";

export type PublicPreviewStatus =
  | "running"
  | "completed"
  | "failed"
  | "converting"
  | "converted"
  | "expired";

export type PublicPreviewSession = {
  id: string;
  status: PublicPreviewStatus;
  addressQuery: string;
  providerName: string | null;
  resultCount: number;
  scanSessionId: string | null;
  selectedCandidateKey: string | null;
  sampleMissionCreatedAt: Date | null;
  convertedTenantId: string | null;
  convertedMissionId: number | null;
  failureCode: string | null;
  expiresAt: Date;
};

export type PublicPreviewAttribution = {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  placement?: string;
};

export type PublicPreviewEvent = {
  eventName: DayforgeProductEventName;
  scopeKey: string;
  tenantId: string | null;
  anonymousSessionId: string | null;
  actorType: "public" | "operator";
  actorId: string | null;
  entityType: "territory_preview" | "commercial_mission";
  entityId: string;
  source: "public_territory_preview";
  correlationId: string;
  idempotencyKey: string;
  properties?: Record<string, unknown>;
};

export interface PublicPreviewRepository {
  assertStartLimits(input: { ipHash: string; now: Date }): Promise<void>;
  assertSessionLimit(input: {
    sessionId: string;
    action: "status" | "execute" | "open" | "sample" | "convert";
    now: Date;
  }): Promise<void>;
  createRunningSession(input: {
    sessionId: string;
    tokenHash: string;
    ipHash: string;
    addressQuery: string;
    attribution: PublicPreviewAttribution | null;
    expiresAt: Date;
    purgeAfter: Date;
    event: PublicPreviewEvent;
  }): Promise<void>;
  claimExecution(input: {
    sessionId: string;
    providerName: string;
    now: Date;
    leaseUntil: Date;
    event: PublicPreviewEvent;
  }): Promise<"claimed" | "busy" | "not_running">;
  getAuthorizedSession(input: {
    sessionId: string;
    tokenHash: string;
    now: Date;
  }): Promise<PublicPreviewSession | null>;
  completeSession(input: {
    sessionId: string;
    providerName: string;
    resultCount: number;
    scanSessionId: string;
    event: PublicPreviewEvent;
  }): Promise<void>;
  failSession(input: {
    sessionId: string;
    providerName: string;
    failureCode: string;
    event: PublicPreviewEvent;
  }): Promise<void>;
  listOpportunities(
    scanSessionId: string
  ): Promise<RankedTerritoryOpportunity[]>;
  getScanCenter(scanSessionId: string): Promise<GeoPoint | null>;
  getOpportunity(input: {
    scanSessionId: string;
    candidateKey: string;
  }): Promise<RankedTerritoryOpportunity | null>;
  selectOpportunity(input: {
    sessionId: string;
    candidateKey: string;
    sampleMissionCreated: boolean;
    now: Date;
  }): Promise<boolean>;
  claimConversion(input: {
    sessionId: string;
    candidateKey: string;
    tenantId: string;
    now: Date;
  }): Promise<"claimed" | "owned_retry" | "other_tenant" | "not_convertible">;
  completeConversion(input: {
    sessionId: string;
    tenantId: string;
    missionId: number;
  }): Promise<void>;
  appendEvent(event: PublicPreviewEvent): Promise<void>;
}

export type PublicPreviewMissionCreator = (input: {
  tenantId: string;
  assignedTo?: string | null;
  opportunity: RankedTerritoryOpportunity;
  actorId: string;
  idempotencyKey: string;
}) => Promise<CommercialMission>;

export type PersistPreviewScan = (input: {
  addressQuery: string;
  result: TerritoryDiscoveryResult;
}) => Promise<{ scanId: string; expiresAt: string }>;

export type PublicPreviewServiceDependencies = {
  repository: PublicPreviewRepository;
  provider: TerritoryBusinessProvider;
  operator: LaundryTerritoryOperatorContext;
  persistScan: PersistPreviewScan;
  createMission: PublicPreviewMissionCreator;
  discover?: typeof discoverLaundryTerritory;
  now?: () => Date;
};

export class PublicPreviewRateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number
  ) {
    super(message);
    this.name = "PublicPreviewRateLimitError";
  }
}

export class PublicPreviewAccessError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "EXPIRED" | "INVALID_STATE" | "OTHER_TENANT",
    message: string
  ) {
    super(message);
    this.name = "PublicPreviewAccessError";
  }
}

function publicStatus(status: PublicPreviewStatus) {
  return status === "converting" ? ("running" as const) : status;
}

function safeFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("geocod") || message.includes("zero_results")) {
    return "address_not_found";
  }
  if (message.includes("rate") || message.includes("quota")) {
    return "provider_capacity";
  }
  if (message.includes("timeout") || message.includes("abort")) {
    return "provider_timeout";
  }
  return "provider_unavailable";
}

function sourcePlacement(attribution?: PublicPreviewAttribution): string {
  return (attribution?.placement ?? attribution?.source ?? "direct").slice(
    0,
    96
  );
}

function scoreBand(opportunity: RankedTerritoryOpportunity): string {
  return opportunity.score.grade;
}

function estimatedValueBand(cents: number): string {
  if (cents >= 2_500_000) return "25k_plus";
  if (cents >= 1_000_000) return "10k_25k";
  if (cents >= 500_000) return "5k_10k";
  return "under_5k";
}

function event(input: {
  eventName: DayforgeProductEventName;
  sessionId: string;
  tenantId?: string | null;
  actorId?: string | null;
  entityType?: "territory_preview" | "commercial_mission";
  entityId?: string;
  idempotencySuffix: string;
  properties?: Record<string, unknown>;
}): PublicPreviewEvent {
  return {
    eventName: input.eventName,
    scopeKey: input.tenantId
      ? `tenant:${input.tenantId}`
      : `public:${input.sessionId}`,
    tenantId: input.tenantId ?? null,
    anonymousSessionId: input.tenantId ? null : input.sessionId,
    actorType: input.tenantId ? "operator" : "public",
    actorId: input.actorId ?? null,
    entityType: input.entityType ?? "territory_preview",
    entityId: input.entityId ?? input.sessionId,
    source: "public_territory_preview",
    correlationId: `territory-preview:${input.sessionId}`,
    idempotencyKey: `territory-preview:${input.sessionId}:${input.idempotencySuffix}`,
    properties: input.properties,
  };
}

export function createPublicPreviewService(
  dependencies: PublicPreviewServiceDependencies
) {
  const clock = dependencies.now ?? (() => new Date());
  const discover = dependencies.discover ?? discoverLaundryTerritory;

  async function authorized(input: {
    sessionId: string;
    tokenHash: string;
    action: "status" | "execute" | "open" | "sample" | "convert";
  }) {
    const now = clock();
    const session = await dependencies.repository.getAuthorizedSession({
      sessionId: input.sessionId,
      tokenHash: input.tokenHash,
      now,
    });
    if (!session) {
      throw new PublicPreviewAccessError(
        "NOT_FOUND",
        "Territory preview session not found"
      );
    }
    await dependencies.repository.assertSessionLimit({
      sessionId: input.sessionId,
      action: input.action,
      now,
    });
    if (session.status === "expired" || session.expiresAt <= now) {
      throw new PublicPreviewAccessError(
        "EXPIRED",
        "Territory preview session has expired"
      );
    }
    return session;
  }

  return {
    async start(input: {
      sessionId: string;
      tokenHash: string;
      ipHash: string;
      address: string;
      attribution?: PublicPreviewAttribution;
    }) {
      const now = clock();
      await dependencies.repository.assertStartLimits({
        ipHash: input.ipHash,
        now,
      });
      await dependencies.repository.createRunningSession({
        sessionId: input.sessionId,
        tokenHash: input.tokenHash,
        ipHash: input.ipHash,
        addressQuery: input.address,
        attribution: input.attribution ?? null,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        purgeAfter: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        event: event({
          eventName: "territory_address_submitted",
          sessionId: input.sessionId,
          idempotencySuffix: "address-submitted",
          properties: {
            sourcePlacement: sourcePlacement(input.attribution),
          },
        }),
      });
      return { sessionId: input.sessionId, status: "running" as const };
    },

    async execute(input: { sessionId: string; tokenHash: string }) {
      const session = await authorized({ ...input, action: "execute" });
      if (session.status !== "running") {
        return { status: publicStatus(session.status) };
      }
      const startedAt = clock();
      const claim = await dependencies.repository.claimExecution({
        sessionId: session.id,
        providerName: dependencies.provider.name,
        now: startedAt,
        leaseUntil: new Date(startedAt.getTime() + 2 * 60 * 1000),
        event: event({
          eventName: "territory_scan_started",
          sessionId: session.id,
          idempotencySuffix: "scan-started",
          properties: {
            mode: "public_preview",
            providerKey: dependencies.provider.name,
          },
        }),
      });
      if (claim === "busy") return { status: "running" as const };
      if (claim === "not_running") {
        const latest = await dependencies.repository.getAuthorizedSession({
          sessionId: session.id,
          tokenHash: input.tokenHash,
          now: clock(),
        });
        return { status: publicStatus(latest?.status ?? "expired") };
      }
      try {
        const result = await discover({
          addressOrBusiness: session.addressQuery,
          provider: dependencies.provider,
          operator: dependencies.operator,
          limit: 12,
        });
        const persisted = await dependencies.persistScan({
          addressQuery: session.addressQuery,
          result,
        });
        await dependencies.repository.completeSession({
          sessionId: input.sessionId,
          providerName: result.providerName,
          resultCount: result.opportunities.length,
          scanSessionId: persisted.scanId,
          event: event({
            eventName: "territory_results_loaded",
            sessionId: input.sessionId,
            idempotencySuffix: "results-loaded",
            properties: {
              providerKey: result.providerName,
              resultCount: result.opportunities.length,
              durationMs: Math.max(0, clock().getTime() - startedAt.getTime()),
              topScoreBand: result.opportunities[0]?.score.grade ?? "none",
            },
          }),
        });
        return { sessionId: input.sessionId, status: "completed" as const };
      } catch (error) {
        const failureCode = safeFailureCode(error);
        console.error("[TerritoryPreview] scan failed", {
          sessionId: input.sessionId,
          providerName: dependencies.provider.name,
          failureCode,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { name: "UnknownError", message: "Unknown provider failure" },
        });
        await dependencies.repository.failSession({
          sessionId: input.sessionId,
          providerName: dependencies.provider.name,
          failureCode,
          event: event({
            eventName: "territory_scan_failed",
            sessionId: input.sessionId,
            idempotencySuffix: "scan-failed",
            properties: {
              failureCode,
              providerKey: dependencies.provider.name,
              retryable: failureCode !== "address_not_found",
            },
          }),
        });
        return { status: "failed" as const };
      }
    },

    async status(input: { sessionId: string; tokenHash: string }) {
      const session = await authorized({ ...input, action: "status" });
      const opportunities = session.scanSessionId
        ? await dependencies.repository.listOpportunities(session.scanSessionId)
        : undefined;
      const center = session.scanSessionId
        ? await dependencies.repository.getScanCenter(session.scanSessionId)
        : undefined;
      const selected =
        session.scanSessionId && session.selectedCandidateKey
          ? await dependencies.repository.getOpportunity({
              scanSessionId: session.scanSessionId,
              candidateKey: session.selectedCandidateKey,
            })
          : null;
      return {
        status: publicStatus(session.status),
        addressDisplay: session.addressQuery,
        center: center ?? undefined,
        opportunities,
        failure: session.failureCode
          ? "The territory scan could not be completed. Please try again."
          : undefined,
        selectedCandidateKey: session.selectedCandidateKey ?? undefined,
        sampleMission:
          selected && session.sampleMissionCreatedAt
            ? buildPublicPreviewSampleMission({
                sessionId: session.id,
                opportunity: selected,
              })
            : undefined,
      };
    },

    async openOpportunity(input: {
      sessionId: string;
      tokenHash: string;
      candidateKey: string;
    }) {
      const session = await authorized({ ...input, action: "open" });
      if (session.status !== "completed" || !session.scanSessionId) {
        throw new PublicPreviewAccessError(
          "INVALID_STATE",
          "Territory results are not ready"
        );
      }
      const opportunity = await dependencies.repository.getOpportunity({
        scanSessionId: session.scanSessionId,
        candidateKey: input.candidateKey,
      });
      if (!opportunity) {
        throw new PublicPreviewAccessError(
          "NOT_FOUND",
          "Territory opportunity not found"
        );
      }
      const opportunities = await dependencies.repository.listOpportunities(
        session.scanSessionId
      );
      const rank = opportunities.findIndex(
        candidate => candidate.candidateKey === input.candidateKey
      );
      await dependencies.repository.selectOpportunity({
        sessionId: session.id,
        candidateKey: input.candidateKey,
        sampleMissionCreated: false,
        now: clock(),
      });
      await dependencies.repository.appendEvent(
        event({
          eventName: "opportunity_opened",
          sessionId: session.id,
          idempotencySuffix: `opportunity-opened:${input.candidateKey}`,
          properties: {
            rank: rank < 0 ? 0 : rank + 1,
            scoreBand: scoreBand(opportunity),
            accountType: opportunity.account.accountType,
          },
        })
      );
      return { ok: true as const, status: "completed" as const };
    },

    async createSampleMission(input: {
      sessionId: string;
      tokenHash: string;
      candidateKey: string;
    }): Promise<{ mission: PublicPreviewSampleMission }> {
      const session = await authorized({ ...input, action: "sample" });
      if (session.status !== "completed" || !session.scanSessionId) {
        throw new PublicPreviewAccessError(
          "INVALID_STATE",
          "Territory results are not ready"
        );
      }
      const opportunity = await dependencies.repository.getOpportunity({
        scanSessionId: session.scanSessionId,
        candidateKey: input.candidateKey,
      });
      if (!opportunity) {
        throw new PublicPreviewAccessError(
          "NOT_FOUND",
          "Territory opportunity not found"
        );
      }
      await dependencies.repository.selectOpportunity({
        sessionId: session.id,
        candidateKey: input.candidateKey,
        sampleMissionCreated: true,
        now: clock(),
      });
      await dependencies.repository.appendEvent(
        event({
          eventName: "sample_mission_created",
          sessionId: session.id,
          idempotencySuffix: `sample-mission:${input.candidateKey}`,
          properties: {
            scoreBand: scoreBand(opportunity),
            estimatedValueBand: estimatedValueBand(
              opportunity.score.estimatedAnnualValueCents
            ),
            accountType: opportunity.account.accountType,
          },
        })
      );
      return {
        mission: buildPublicPreviewSampleMission({
          sessionId: session.id,
          opportunity,
        }),
      };
    },

    async convert(input: {
      sessionId: string;
      tokenHash: string;
      candidateKey: string;
      tenantId: string;
      actorId: string;
      assignedTo?: string | null;
    }) {
      const session = await authorized({ ...input, action: "convert" });
      if (!session.scanSessionId) {
        throw new PublicPreviewAccessError(
          "INVALID_STATE",
          "Territory results are not ready"
        );
      }
      if (
        session.status === "converted" &&
        session.convertedTenantId === input.tenantId &&
        session.convertedMissionId
      ) {
        return { missionId: session.convertedMissionId };
      }
      const opportunity = await dependencies.repository.getOpportunity({
        scanSessionId: session.scanSessionId,
        candidateKey: input.candidateKey,
      });
      if (!opportunity) {
        throw new PublicPreviewAccessError(
          "NOT_FOUND",
          "Territory opportunity not found"
        );
      }
      const claim = await dependencies.repository.claimConversion({
        sessionId: session.id,
        candidateKey: input.candidateKey,
        tenantId: input.tenantId,
        now: clock(),
      });
      if (claim === "other_tenant") {
        throw new PublicPreviewAccessError(
          "OTHER_TENANT",
          "Territory preview was already converted by another tenant"
        );
      }
      if (claim === "not_convertible") {
        throw new PublicPreviewAccessError(
          "INVALID_STATE",
          "Territory preview cannot be converted"
        );
      }
      const mission = await dependencies.createMission({
        tenantId: input.tenantId,
        assignedTo: input.assignedTo,
        opportunity,
        actorId: input.actorId,
        // A server-owned key makes retries safe even when the client loses the
        // first response or changes its own request idempotency key.
        idempotencyKey: `public-preview:${session.id}:${input.candidateKey}`,
      });
      await dependencies.repository.completeConversion({
        sessionId: session.id,
        tenantId: input.tenantId,
        missionId: mission.id,
      });
      return { missionId: mission.id };
    },
  };
}
