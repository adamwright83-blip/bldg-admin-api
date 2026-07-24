import { describe, expect, it } from "vitest";
import {
  CommercialCampaignLinkRequestConflictError,
  CommercialCampaignLinkScopeError,
  createCommercialCampaignLinkService,
  hashCommercialCampaignLinkToken,
  type CommercialCampaignLinkInsert,
  type CommercialCampaignLinkRecord,
  type CommercialCampaignLinkRepository,
  type CommercialCampaignLinkScope,
  type CreateCommercialCampaignLinkInput,
} from "./commercialCampaignLinkService";

const SECRET = "campaign-link-test-secret-at-least-32-characters-long";
const NOW = new Date("2026-07-23T12:00:00.000Z");

class MemoryCampaignLinkRepository implements CommercialCampaignLinkRepository {
  records: CommercialCampaignLinkRecord[] = [];
  inserts: CommercialCampaignLinkInsert[] = [];
  ownedTenants = new Set(["tenant-a"]);

  async ownsScope(input: CommercialCampaignLinkScope) {
    return (
      this.ownedTenants.has(input.tenantId) &&
      input.accountId === 11 &&
      input.missionId === 22 &&
      input.salespersonId === "salesperson-7" &&
      (input.pipelineId === null || input.pipelineId === 33) &&
      (input.referringContactId === null || input.referringContactId === 44)
    );
  }

  async findByRequestId(input: { tenantId: string; requestId: string }) {
    return (
      this.records.find(
        record =>
          record.tenantId === input.tenantId &&
          record.requestId === input.requestId
      ) ?? null
    );
  }

  async findByTokenHash(input: { tenantId: string; tokenHash: string }) {
    return (
      this.records.find(
        record =>
          record.tenantId === input.tenantId &&
          record.tokenHash === input.tokenHash
      ) ?? null
    );
  }

  async insert(input: CommercialCampaignLinkInsert) {
    this.inserts.push({ ...input });
    if (
      this.records.some(
        record =>
          (record.tenantId === input.tenantId &&
            record.requestId === input.requestId) ||
          record.tokenHash === input.tokenHash
      )
    ) {
      return "duplicate" as const;
    }
    this.records.push({
      ...input,
      createdAt: NOW,
      updatedAt: NOW,
    });
    return "inserted" as const;
  }
}

function creationInput(
  overrides: Partial<CreateCommercialCampaignLinkInput> = {}
): CreateCommercialCampaignLinkInput {
  return {
    tenantId: "tenant-a",
    accountId: 11,
    missionId: 22,
    pipelineId: 33,
    campaignName: "Summer Property Partner Push",
    placement: "lobby-counter-card",
    collateralVersion: "v3",
    salespersonId: "salesperson-7",
    referringContactId: 44,
    buildingSlug: "marina-towers",
    offerKey: "property-first-order",
    expiresAt: new Date("2026-08-23T12:00:00.000Z"),
    requestId: "00000000-0000-4000-8000-000000000001",
    actorId: "owner-1",
    ...overrides,
  };
}

function harness() {
  const repository = new MemoryCampaignLinkRepository();
  let id = 0;
  let currentTime = NOW;
  const service = createCommercialCampaignLinkService({
    repository,
    secret: SECRET,
    now: () => currentTime,
    createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
  });
  return {
    repository,
    service,
    setNow(value: Date) {
      currentTime = value;
    },
  };
}

describe("commercial campaign link token foundation", () => {
  it("creates a unique opaque token for every distinct link", async () => {
    const value = harness();
    const first = await value.service.create(creationInput());
    const second = await value.service.create(
      creationInput({
        requestId: "00000000-0000-4000-8000-000000000002",
        placement: "leasing-office-flyer",
      })
    );

    expect(first.token).toMatch(/^dfcl_[A-Za-z0-9_-]{43}$/);
    expect(second.token).toMatch(/^dfcl_[A-Za-z0-9_-]{43}$/);
    expect(second.token).not.toBe(first.token);
    expect(second.link.id).not.toBe(first.link.id);
  });

  it("persists only the SHA-256 token hash and never returns it publicly", async () => {
    const value = harness();
    const created = await value.service.create(creationInput());
    const persisted = value.repository.inserts[0];

    expect(persisted.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.tokenHash).toBe(
      hashCommercialCampaignLinkToken(created.token)
    );
    expect(persisted).not.toHaveProperty("token");
    expect(JSON.stringify(persisted)).not.toContain(created.token);
    expect(created.link).not.toHaveProperty("tokenHash");

    const validated = await value.service.validate({
      tenantId: "tenant-a",
      token: created.token,
    });
    expect(validated).toEqual({
      valid: true,
      link: {
        buildingSlug: "marina-towers",
        offerKey: "property-first-order",
      },
    });
    if (validated.valid) {
      expect(Object.keys(validated.link).sort()).toEqual([
        "buildingSlug",
        "offerKey",
      ]);
    }
  });

  it("is idempotent for the same tenant request ID and rejects changed details", async () => {
    const value = harness();
    const first = await value.service.create(creationInput());
    const replay = await value.service.create(creationInput());

    expect(replay).toEqual({ ...first, created: false });
    expect(value.repository.records).toHaveLength(1);
    expect(value.repository.inserts).toHaveLength(1);

    await expect(
      value.service.create(
        creationInput({ campaignName: "Different campaign" })
      )
    ).rejects.toBeInstanceOf(CommercialCampaignLinkRequestConflictError);
    expect(value.repository.records).toHaveLength(1);
  });

  it("enforces tenant-owned commercial scope and hides tokens from other tenants", async () => {
    const value = harness();
    const created = await value.service.create(creationInput());

    await expect(
      value.service.create(
        creationInput({
          tenantId: "tenant-b",
          requestId: "00000000-0000-4000-8000-000000000099",
        })
      )
    ).rejects.toBeInstanceOf(CommercialCampaignLinkScopeError);

    await expect(
      value.service.create(
        creationInput({
          salespersonId: "cross-tenant-user",
          requestId: "00000000-0000-4000-8000-000000000097",
        })
      )
    ).rejects.toBeInstanceOf(CommercialCampaignLinkScopeError);

    await expect(
      value.service.create(
        creationInput({
          accountId: 999,
          requestId: "00000000-0000-4000-8000-000000000098",
        })
      )
    ).rejects.toBeInstanceOf(CommercialCampaignLinkScopeError);

    expect(
      await value.service.validate({
        tenantId: "tenant-b",
        token: created.token,
      })
    ).toEqual({ valid: false, reason: "not_found" });
  });

  it("accepts active links and rejects links after their expiry", async () => {
    const value = harness();
    const expiresAt = new Date("2026-07-23T13:00:00.000Z");
    const created = await value.service.create(creationInput({ expiresAt }));

    expect(
      await value.service.validate({
        tenantId: "tenant-a",
        token: created.token,
      })
    ).toMatchObject({ valid: true });

    value.setNow(expiresAt);
    expect(
      await value.service.validate({
        tenantId: "tenant-a",
        token: created.token,
      })
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("rejects revoked links even when their expiry is still in the future", async () => {
    const value = harness();
    const created = await value.service.create(creationInput());
    const record = value.repository.records[0];
    record.status = "revoked";
    record.revokedAt = new Date("2026-07-23T12:05:00.000Z");

    expect(
      await value.service.validate({
        tenantId: "tenant-a",
        token: created.token,
      })
    ).toEqual({ valid: false, reason: "revoked" });
  });
});
