import { describe, expect, it, vi } from "vitest";
import { createDeterministicTerritoryProvider } from "./testSupport/deterministicTerritoryProvider";
import {
  createPublicPreviewService,
  PublicPreviewAccessError,
  type PublicPreviewEvent,
  type PublicPreviewRepository,
  type PublicPreviewSession,
} from "./publicPreviewService";
import type {
  RankedTerritoryOpportunity,
  TerritoryDiscoveryResult,
} from "./territoryDiscovery";

const NOW = new Date("2026-07-13T12:00:00.000Z");

class MemoryRepository implements PublicPreviewRepository {
  session: PublicPreviewSession | null = null;
  tokenHash = "";
  opportunities: RankedTerritoryOpportunity[] = [];
  events: PublicPreviewEvent[] = [];
  executionClaimed = false;

  async assertStartLimits() {}
  async assertSessionLimit() {}
  async createRunningSession(input: Parameters<PublicPreviewRepository["createRunningSession"]>[0]) {
    this.tokenHash = input.tokenHash;
    this.session = {
      id: input.sessionId,
      status: "running",
      addressQuery: input.addressQuery,
      providerName: null,
      resultCount: 0,
      scanSessionId: null,
      selectedCandidateKey: null,
      sampleMissionCreatedAt: null,
      convertedTenantId: null,
      convertedMissionId: null,
      failureCode: null,
      expiresAt: input.expiresAt,
    };
  }
  async getAuthorizedSession(input: Parameters<PublicPreviewRepository["getAuthorizedSession"]>[0]) {
    return this.session?.id === input.sessionId && this.tokenHash === input.tokenHash
      ? { ...this.session }
      : null;
  }
  async claimExecution() {
    if (!this.session || this.session.status !== "running") return "not_running" as const;
    if (this.executionClaimed) return "busy" as const;
    this.executionClaimed = true;
    return "claimed" as const;
  }
  async completeSession(input: Parameters<PublicPreviewRepository["completeSession"]>[0]) {
    if (!this.session) throw new Error("missing session");
    this.session.status = "completed";
    this.session.providerName = input.providerName;
    this.session.resultCount = input.resultCount;
    this.session.scanSessionId = input.scanSessionId;
  }
  async failSession(input: Parameters<PublicPreviewRepository["failSession"]>[0]) {
    if (!this.session) throw new Error("missing session");
    this.session.status = "failed";
    this.session.failureCode = input.failureCode;
  }
  async listOpportunities() {
    return this.opportunities;
  }
  async getScanCenter() {
    return {
      lat: 34.052235,
      lng: -118.243683,
      formattedAddress: "100 Release Gate Way, Los Angeles, CA 90012",
    };
  }
  async getOpportunity(input: Parameters<PublicPreviewRepository["getOpportunity"]>[0]) {
    return (
      this.opportunities.find(item => item.candidateKey === input.candidateKey) ??
      null
    );
  }
  async selectOpportunity(input: Parameters<PublicPreviewRepository["selectOpportunity"]>[0]) {
    if (!this.session) return false;
    this.session.selectedCandidateKey = input.candidateKey;
    this.session.sampleMissionCreatedAt = input.sampleMissionCreated
      ? input.now
      : null;
    return true;
  }
  async claimConversion(input: Parameters<PublicPreviewRepository["claimConversion"]>[0]) {
    if (!this.session) return "not_convertible" as const;
    if (this.session.status === "converted" || this.session.status === "converting") {
      return this.session.convertedTenantId === input.tenantId
        ? ("owned_retry" as const)
        : ("other_tenant" as const);
    }
    if (
      this.session.status !== "completed" ||
      !this.session.sampleMissionCreatedAt ||
      this.session.selectedCandidateKey !== input.candidateKey
    ) {
      return "not_convertible" as const;
    }
    this.session.status = "converting";
    this.session.convertedTenantId = input.tenantId;
    return "claimed" as const;
  }
  async completeConversion(input: Parameters<PublicPreviewRepository["completeConversion"]>[0]) {
    if (!this.session) throw new Error("missing session");
    this.session.status = "converted";
    this.session.convertedTenantId = input.tenantId;
    this.session.convertedMissionId = input.missionId;
  }
  async appendEvent(value: PublicPreviewEvent) {
    if (!this.events.some(event => event.idempotencyKey === value.idempotencyKey)) {
      this.events.push(value);
    }
  }
}

function harness(input?: {
  repository?: MemoryRepository;
  discover?: () => Promise<TerritoryDiscoveryResult>;
}) {
  const repository = input?.repository ?? new MemoryRepository();
  const provider = createDeterministicTerritoryProvider();
  const createMission = vi.fn(async () => ({ id: 42 }) as never);
  const service = createPublicPreviewService({
    repository,
    provider,
    operator: {
      tenantId: "public-preview",
      serviceRadiusMiles: 3,
      commercialWashFoldEnabled: true,
      averagePricePerPoundCents: 250,
      availableWeeklyCapacityPounds: 1_000,
      routePoints: [],
      turnaroundCompatibleByDefault: true,
      pickupDaysCompatibleByDefault: true,
    },
    persistScan: async ({ result }) => {
      repository.opportunities = result.opportunities;
      return { scanId: "scan-123456789", expiresAt: NOW.toISOString() };
    },
    createMission,
    discover: input?.discover as never,
    now: () => NOW,
  });
  return { repository, provider, createMission, service };
}

async function startAndExecute(value: ReturnType<typeof harness>) {
  await value.service.start({
    sessionId: "session-123456789",
    tokenHash: "token-hash",
    ipHash: "ip-hash",
    address: "100 Main St, Los Angeles, CA",
    attribution: { placement: "hero" },
  });
  return value.service.execute({
    sessionId: "session-123456789",
    tokenHash: "token-hash",
  });
}

describe("production public territory preview service", () => {
  it("returns credentials after persisting running state and before provider execution", async () => {
    const value = harness();
    const geocode = vi.spyOn(value.provider, "geocode");
    const started = await value.service.start({
      sessionId: "session-123456789",
      tokenHash: "token-hash",
      ipHash: "ip-hash",
      address: "100 Main St, Los Angeles, CA",
    });
    expect(started.status).toBe("running");
    expect(value.repository.session?.status).toBe("running");
    expect(geocode).not.toHaveBeenCalled();

    await value.service.execute({
      sessionId: "session-123456789",
      tokenHash: "token-hash",
    });
    expect(geocode).toHaveBeenCalledOnce();
    expect(value.repository.session?.status).toBe("completed");
  });

  it("uses a lease so overlapping execute calls do not fan out provider work", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const realProvider = createDeterministicTerritoryProvider();
    const discover = vi.fn(async () => {
      await gate;
      const center = await realProvider.geocode("address");
      const candidates = await realProvider.searchBusinesses({
        center,
        radiusMiles: 3,
        categories: [],
        limit: 12,
      });
      return {
        providerName: realProvider.name,
        center,
        providerCandidateCount: candidates.length,
        dedupedCandidateCount: 0,
        opportunities: [],
      };
    });
    const value = harness({ discover });
    await value.service.start({
      sessionId: "session-123456789",
      tokenHash: "token-hash",
      ipHash: "ip-hash",
      address: "100 Main St, Los Angeles, CA",
    });
    const first = value.service.execute({
      sessionId: "session-123456789",
      tokenHash: "token-hash",
    });
    await vi.waitFor(() => expect(discover).toHaveBeenCalledOnce());
    await expect(
      value.service.execute({
        sessionId: "session-123456789",
        tokenHash: "token-hash",
      })
    ).resolves.toEqual({ status: "running" });
    release();
    await first;
    expect(discover).toHaveBeenCalledOnce();
  });

  it("persists a safe failed state without returning provider details", async () => {
    const value = harness({
      discover: async () => {
        throw new Error("Google secret quota response: internal details");
      },
    });
    await expect(startAndExecute(value)).resolves.toEqual({ status: "failed" });
    const resumed = await value.service.status({
      sessionId: "session-123456789",
      tokenHash: "token-hash",
    });
    expect(resumed.status).toBe("failed");
    expect(resumed.failure).not.toContain("Google");
    expect(value.repository.session?.failureCode).toBe("provider_capacity");
  });

  it("creates and resumes a sample without creating a tenant mission", async () => {
    const value = harness();
    await startAndExecute(value);
    const opportunity = value.repository.opportunities[0]!;
    const sample = await value.service.createSampleMission({
      sessionId: "session-123456789",
      tokenHash: "token-hash",
      candidateKey: opportunity.candidateKey,
    });
    expect(sample.mission.status).toBe("sample");
    expect(value.createMission).not.toHaveBeenCalled();
    const resumed = await value.service.status({
      sessionId: "session-123456789",
      tokenHash: "token-hash",
    });
    expect(resumed.sampleMission?.id).toBe(sample.mission.id);
  });

  it("converts exactly once for one tenant and denies a second tenant", async () => {
    const value = harness();
    await startAndExecute(value);
    const candidateKey = value.repository.opportunities[0]!.candidateKey;
    await value.service.createSampleMission({
      sessionId: "session-123456789",
      tokenHash: "token-hash",
      candidateKey,
    });
    const input = {
      sessionId: "session-123456789",
      tokenHash: "token-hash",
      candidateKey,
      tenantId: "tenant-a",
      actorId: "owner-a",
    };
    await expect(value.service.convert(input)).resolves.toEqual({ missionId: 42 });
    await expect(value.service.convert(input)).resolves.toEqual({ missionId: 42 });
    expect(value.createMission).toHaveBeenCalledOnce();
    await expect(
      value.service.convert({ ...input, tenantId: "tenant-b", actorId: "owner-b" })
    ).rejects.toBeInstanceOf(PublicPreviewAccessError);
  });
});
