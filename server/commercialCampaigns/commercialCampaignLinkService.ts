import { createHash, createHmac, randomUUID } from "node:crypto";

const CAMPAIGN_LINK_TOKEN_PREFIX = "dfcl_";

export type CommercialCampaignLinkStatus = "active" | "expired" | "revoked";

export type CommercialCampaignLinkRecord = {
  id: string;
  tenantId: string;
  accountId: number;
  missionId: number;
  pipelineId: number | null;
  campaignName: string;
  placement: string;
  collateralVersion: string;
  salespersonId: string;
  referringContactId: number | null;
  buildingSlug: string | null;
  offerKey: string | null;
  tokenHash: string;
  status: CommercialCampaignLinkStatus;
  expiresAt: Date | null;
  revokedAt: Date | null;
  requestId: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CommercialCampaignLinkInsert = Omit<
  CommercialCampaignLinkRecord,
  "createdAt" | "updatedAt"
>;

export type CommercialCampaignLinkScope = Pick<
  CommercialCampaignLinkRecord,
  | "tenantId"
  | "accountId"
  | "missionId"
  | "pipelineId"
  | "salespersonId"
  | "referringContactId"
>;

export interface CommercialCampaignLinkRepository {
  ownsScope(input: CommercialCampaignLinkScope): Promise<boolean>;
  findByRequestId(input: {
    tenantId: string;
    requestId: string;
  }): Promise<CommercialCampaignLinkRecord | null>;
  findByTokenHash(input: {
    tenantId: string;
    tokenHash: string;
  }): Promise<CommercialCampaignLinkRecord | null>;
  insert(
    input: CommercialCampaignLinkInsert
  ): Promise<"inserted" | "duplicate">;
}

export class CommercialCampaignLinkScopeError extends Error {
  constructor() {
    super("Campaign link scope is invalid for this tenant");
    this.name = "CommercialCampaignLinkScopeError";
  }
}

export class CommercialCampaignLinkRequestConflictError extends Error {
  constructor() {
    super("Campaign link request ID is already bound to different details");
    this.name = "CommercialCampaignLinkRequestConflictError";
  }
}

export type CreateCommercialCampaignLinkInput = {
  tenantId: string;
  accountId: number;
  missionId: number;
  pipelineId?: number | null;
  campaignName: string;
  placement: string;
  collateralVersion: string;
  salespersonId: string;
  referringContactId?: number | null;
  buildingSlug?: string | null;
  offerKey?: string | null;
  expiresAt?: Date | null;
  requestId: string;
  actorId: string;
};

export type CommercialCampaignLinkDetails = Omit<
  CommercialCampaignLinkRecord,
  "tokenHash"
>;

/**
 * Data that an unauthenticated campaign landing page may render. Attribution
 * identity and ownership fields deliberately remain server-side and are
 * resolved again from the bearer token when an acquisition is captured.
 */
export type PublicCommercialCampaignLink = Pick<
  CommercialCampaignLinkRecord,
  "buildingSlug" | "offerKey"
>;

export type CommercialCampaignLinkValidation =
  | {
      valid: true;
      link: PublicCommercialCampaignLink;
    }
  | {
      valid: false;
      reason: "not_found" | "expired" | "revoked";
    };

function requireCampaignLinkSecret(value: string): string {
  const secret = value.trim();
  if (secret.length < 32) {
    throw new Error(
      "DAYFORGE_CAMPAIGN_LINK_TOKEN_SECRET must contain at least 32 characters"
    );
  }
  return secret;
}

export function commercialCampaignLinkTokenSecret(): string {
  return requireCampaignLinkSecret(
    process.env.DAYFORGE_CAMPAIGN_LINK_TOKEN_SECRET ??
      process.env.APP_SHARED_API_SECRET ??
      process.env.JWT_SECRET ??
      ""
  );
}

/**
 * The opaque token can be reproduced for an idempotent request without ever
 * persisting the bearer credential. The link ID is random, and the HMAC keeps
 * it impossible to derive the token from database fields alone.
 */
export function createCommercialCampaignLinkToken(input: {
  tenantId: string;
  linkId: string;
  secret?: string;
}): string {
  const secret = requireCampaignLinkSecret(
    input.secret ?? commercialCampaignLinkTokenSecret()
  );
  const opaqueValue = createHmac("sha256", secret)
    .update(`commercial-campaign-link:v1:${input.tenantId}:${input.linkId}`)
    .digest("base64url");
  return `${CAMPAIGN_LINK_TOKEN_PREFIX}${opaqueValue}`;
}

export function hashCommercialCampaignLinkToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

function normalizedOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeCreateInput(
  input: CreateCommercialCampaignLinkInput
): Omit<
  CommercialCampaignLinkInsert,
  "id" | "tokenHash" | "status" | "revokedAt"
> {
  return {
    tenantId: input.tenantId.trim(),
    accountId: input.accountId,
    missionId: input.missionId,
    pipelineId: input.pipelineId ?? null,
    campaignName: input.campaignName.trim(),
    placement: input.placement.trim(),
    collateralVersion: input.collateralVersion.trim(),
    salespersonId: input.salespersonId.trim(),
    referringContactId: input.referringContactId ?? null,
    buildingSlug: normalizedOptional(input.buildingSlug),
    offerKey: normalizedOptional(input.offerKey),
    expiresAt: input.expiresAt ?? null,
    requestId: input.requestId.trim(),
    createdBy: input.actorId.trim(),
  };
}

function requestMatches(
  record: CommercialCampaignLinkRecord,
  input: ReturnType<typeof normalizeCreateInput>
): boolean {
  return (
    record.tenantId === input.tenantId &&
    record.accountId === input.accountId &&
    record.missionId === input.missionId &&
    record.pipelineId === input.pipelineId &&
    record.campaignName === input.campaignName &&
    record.placement === input.placement &&
    record.collateralVersion === input.collateralVersion &&
    record.salespersonId === input.salespersonId &&
    record.referringContactId === input.referringContactId &&
    record.buildingSlug === input.buildingSlug &&
    record.offerKey === input.offerKey &&
    (record.expiresAt?.getTime() ?? null) ===
      (input.expiresAt?.getTime() ?? null) &&
    record.requestId === input.requestId &&
    record.createdBy === input.createdBy
  );
}

function campaignLinkDetails(
  record: CommercialCampaignLinkRecord
): CommercialCampaignLinkDetails {
  const { tokenHash: _tokenHash, ...safeRecord } = record;
  return safeRecord;
}

function publicLandingRecord(
  record: CommercialCampaignLinkRecord
): PublicCommercialCampaignLink {
  return {
    buildingSlug: record.buildingSlug,
    offerKey: record.offerKey,
  };
}

export function createCommercialCampaignLinkService(input: {
  repository: CommercialCampaignLinkRepository;
  secret?: string;
  now?: () => Date;
  createId?: () => string;
}) {
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? randomUUID;
  const secret = requireCampaignLinkSecret(
    input.secret ?? commercialCampaignLinkTokenSecret()
  );

  function tokenFor(
    record: Pick<CommercialCampaignLinkRecord, "id" | "tenantId">
  ) {
    return createCommercialCampaignLinkToken({
      tenantId: record.tenantId,
      linkId: record.id,
      secret,
    });
  }

  async function materializeExisting(
    record: CommercialCampaignLinkRecord,
    normalized: ReturnType<typeof normalizeCreateInput>
  ) {
    if (!requestMatches(record, normalized)) {
      throw new CommercialCampaignLinkRequestConflictError();
    }
    const token = tokenFor(record);
    if (hashCommercialCampaignLinkToken(token) !== record.tokenHash) {
      throw new Error("Campaign link token configuration changed");
    }
    return {
      link: campaignLinkDetails(record),
      token,
      created: false as const,
    };
  }

  return {
    async create(createInput: CreateCommercialCampaignLinkInput) {
      const normalized = normalizeCreateInput(createInput);
      const existing = await input.repository.findByRequestId({
        tenantId: normalized.tenantId,
        requestId: normalized.requestId,
      });
      if (existing) return materializeExisting(existing, normalized);

      if (!(await input.repository.ownsScope(normalized))) {
        throw new CommercialCampaignLinkScopeError();
      }

      const id = createId();
      const token = createCommercialCampaignLinkToken({
        tenantId: normalized.tenantId,
        linkId: id,
        secret,
      });
      const createdAt = now();
      const insert: CommercialCampaignLinkInsert = {
        id,
        ...normalized,
        tokenHash: hashCommercialCampaignLinkToken(token),
        status: "active",
        revokedAt: null,
      };
      const outcome = await input.repository.insert(insert);
      if (outcome === "inserted") {
        return {
          link: campaignLinkDetails({
            ...insert,
            createdAt,
            updatedAt: createdAt,
          }),
          token,
          created: true as const,
        };
      }

      const concurrent = await input.repository.findByRequestId({
        tenantId: normalized.tenantId,
        requestId: normalized.requestId,
      });
      if (!concurrent) {
        throw new Error("Campaign link could not be created");
      }
      return materializeExisting(concurrent, normalized);
    },

    async validate(validationInput: {
      tenantId: string;
      token: string;
    }): Promise<CommercialCampaignLinkValidation> {
      const tenantId = validationInput.tenantId.trim();
      const token = validationInput.token.trim();
      if (!tenantId || !token.startsWith(CAMPAIGN_LINK_TOKEN_PREFIX)) {
        return { valid: false, reason: "not_found" };
      }
      const record = await input.repository.findByTokenHash({
        tenantId,
        tokenHash: hashCommercialCampaignLinkToken(token),
      });
      if (!record) return { valid: false, reason: "not_found" };
      if (record.status === "revoked" || record.revokedAt) {
        return { valid: false, reason: "revoked" };
      }
      if (
        record.status === "expired" ||
        (record.expiresAt !== null &&
          record.expiresAt.getTime() <= now().getTime())
      ) {
        return { valid: false, reason: "expired" };
      }
      return { valid: true, link: publicLandingRecord(record) };
    },
  };
}
