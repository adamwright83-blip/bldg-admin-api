import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { communicationContextLinks } from "../../drizzle/schema";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import {
  communicationContextLinkIdempotencyKey,
  isCommunicationLinkSource,
  isCommunicationPartyClass,
  type CommunicationLinkEntityKind,
  type CommunicationLinkSource,
  type CommunicationPartyClass,
} from "@shared/communicationsAnalytics";
import { providerSidIsGoldlineEntityId } from "@shared/twilioPlatform";
import type { CommunicationContextLinkRecord } from "./records";

const IDEMPOTENCY_KEY_MAX = 191;

export type CommunicationContextLinkStore = {
  insertOrGet(
    link: StoredCommunicationContextLink
  ): Promise<{ link: StoredCommunicationContextLink; duplicate: boolean }>;
};

export type StoredCommunicationContextLink = CommunicationContextLinkRecord & {
  id: string;
  idempotencyKey: string;
  createdAt: string;
};

export type RecordCommunicationContextLinkInput = {
  tenantId: string;
  providerResourceSid: string;
  resourceKind: "call" | "message";
  partyClass?: CommunicationPartyClass | null;
  goldlineEntityKind?: CommunicationLinkEntityKind | null;
  goldlineEntityId?: string | null;
  source: CommunicationLinkSource;
  proof: string;
};

export class CommunicationContextLinkError extends Error {
  readonly code: "invalid_source" | "missing_identity" | "provider_sid_as_entity";

  constructor(code: CommunicationContextLinkError["code"], message: string) {
    super(message);
    this.name = "CommunicationContextLinkError";
    this.code = code;
  }
}

function fitIdempotencyKey(raw: string): string {
  if (raw.length <= IDEMPOTENCY_KEY_MAX) return raw;
  return `ctx:hash:${createHash("sha256").update(raw).digest("hex")}`.slice(
    0,
    IDEMPOTENCY_KEY_MAX
  );
}

let testStore: CommunicationContextLinkStore | null = null;

export function createMemoryCommunicationContextLinkStore(): CommunicationContextLinkStore {
  const byKey = new Map<string, StoredCommunicationContextLink>();
  return {
    async insertOrGet(link) {
      const existing = byKey.get(link.idempotencyKey);
      if (existing) return { link: existing, duplicate: true };
      byKey.set(link.idempotencyKey, link);
      return { link, duplicate: false };
    },
  };
}

export function setCommunicationContextLinkStoreForTests(
  store: CommunicationContextLinkStore | null
): void {
  testStore = store;
}

export function buildCommunicationContextLink(
  input: RecordCommunicationContextLinkInput
): StoredCommunicationContextLink {
  if (!isCommunicationLinkSource(input.source)) {
    throw new CommunicationContextLinkError(
      "invalid_source",
      "communication context link source is not in the allowed vocabulary"
    );
  }
  const tenantId = input.tenantId.trim();
  const providerResourceSid = input.providerResourceSid.trim();
  if (!tenantId || !providerResourceSid) {
    throw new CommunicationContextLinkError(
      "missing_identity",
      "communication context link requires tenantId and provider SID"
    );
  }
  const goldlineEntityId = input.goldlineEntityId?.trim() || null;
  if (
    goldlineEntityId &&
    (goldlineEntityId === providerResourceSid ||
      providerSidIsGoldlineEntityId(goldlineEntityId))
  ) {
    throw new CommunicationContextLinkError(
      "provider_sid_as_entity",
      "provider SID was treated as a Goldline entity id"
    );
  }
  const partyClass = input.partyClass ?? null;
  if (partyClass != null && !isCommunicationPartyClass(partyClass)) {
    throw new CommunicationContextLinkError(
      "invalid_source",
      "communication context link party class is invalid"
    );
  }
  const goldlineEntityKind = input.goldlineEntityKind ?? null;
  const idempotencyKey = fitIdempotencyKey(
    communicationContextLinkIdempotencyKey({
      tenantId,
      providerResourceSid,
      source: input.source,
      goldlineEntityKind,
      goldlineEntityId,
      partyClass,
    })
  );
  return {
    id: randomUUID(),
    tenantId,
    providerResourceSid,
    resourceKind: input.resourceKind,
    partyClass,
    goldlineEntityKind,
    goldlineEntityId,
    source: input.source,
    proof: input.proof.trim().slice(0, 191),
    idempotencyKey,
    createdAt: new Date().toISOString(),
  };
}

type ContextLinkQuery = {
  insert: (table: unknown) => {
    values: (row: typeof communicationContextLinks.$inferInsert) => Promise<unknown>;
  };
  select: () => {
    from: (table: unknown) => {
      where: (clause: unknown) => {
        limit: (count: number) => Promise<
          Array<typeof communicationContextLinks.$inferSelect>
        >;
      };
    };
  };
};

function fromRow(
  row: typeof communicationContextLinks.$inferSelect
): StoredCommunicationContextLink {
  if (!isCommunicationLinkSource(row.source)) {
    throw new CommunicationContextLinkError(
      "invalid_source",
      "stored communication context link source is invalid"
    );
  }
  const partyClass =
    row.partyClass && isCommunicationPartyClass(row.partyClass)
      ? row.partyClass
      : null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    providerResourceSid: row.providerResourceSid,
    resourceKind: row.resourceKind === "message" ? "message" : "call",
    partyClass,
    goldlineEntityKind:
      (row.goldlineEntityKind as CommunicationLinkEntityKind | null) ?? null,
    goldlineEntityId: row.goldlineEntityId,
    source: row.source,
    proof: row.proof,
    idempotencyKey: row.idempotencyKey,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt).toISOString(),
  };
}

export async function persistCommunicationContextLink(
  db: ContextLinkQuery,
  link: StoredCommunicationContextLink
): Promise<{ link: StoredCommunicationContextLink; duplicate: boolean }> {
  try {
    await db.insert(communicationContextLinks).values({
      id: link.id,
      tenantId: link.tenantId,
      providerResourceSid: link.providerResourceSid,
      resourceKind: link.resourceKind,
      partyClass: link.partyClass,
      goldlineEntityKind: link.goldlineEntityKind,
      goldlineEntityId: link.goldlineEntityId,
      source: link.source,
      proof: link.proof,
      idempotencyKey: link.idempotencyKey,
      createdAt: new Date(link.createdAt),
    });
    return { link, duplicate: false };
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
    const existing = await db
      .select()
      .from(communicationContextLinks)
      .where(eq(communicationContextLinks.idempotencyKey, link.idempotencyKey))
      .limit(1);
    if (!existing[0]) throw error;
    return { link: fromRow(existing[0]), duplicate: true };
  }
}

function createDrizzleStore(): CommunicationContextLinkStore {
  return {
    async insertOrGet(link) {
      const db = await getDb();
      if (!db) {
        throw new CommunicationContextLinkError(
          "missing_identity",
          "communication context links require a database"
        );
      }
      return persistCommunicationContextLink(db as unknown as ContextLinkQuery, link);
    },
  };
}

async function resolveStore(
  explicit?: CommunicationContextLinkStore
): Promise<CommunicationContextLinkStore | null> {
  if (explicit) return explicit;
  if (testStore) return testStore;
  if (process.env.DATABASE_URL) return createDrizzleStore();
  return null;
}

export async function recordCommunicationContextLink(
  input: RecordCommunicationContextLinkInput,
  options?: { store?: CommunicationContextLinkStore }
): Promise<{ link: StoredCommunicationContextLink; duplicate: boolean } | null> {
  const link = buildCommunicationContextLink(input);
  const store = await resolveStore(options?.store);
  if (!store) return null;
  return store.insertOrGet(link);
}

export async function recordOperatorArtifactInternalLink(input: {
  tenantId: string;
  operatorUserId: string | null | undefined;
  messageSid: string;
}): Promise<void> {
  const messageSid = input.messageSid.trim();
  const tenantId = input.tenantId.trim();
  const operatorUserId = input.operatorUserId?.trim() || null;
  if (!messageSid || !tenantId) return;
  try {
    await recordCommunicationContextLink({
      tenantId,
      providerResourceSid: messageSid,
      resourceKind: "message",
      partyClass: "system_to_operator",
      goldlineEntityKind: operatorUserId ? "operator" : null,
      goldlineEntityId: operatorUserId,
      source: "direct_provider_link",
      proof:
        "sendOperatorArtifact SMS to authorizedOperatorPhone; destination is not caller-supplied",
    });
  } catch {
    // Fail-soft: receipts remain the provider log. Linkage stays sparse.
  }
}

export async function findStoredContextLinkByKey(
  db: ContextLinkQuery,
  idempotencyKey: string
): Promise<StoredCommunicationContextLink | null> {
  const rows = await db
    .select()
    .from(communicationContextLinks)
    .where(
      and(eq(communicationContextLinks.idempotencyKey, idempotencyKey))
    )
    .limit(1);
  return rows[0] ? fromRow(rows[0]) : null;
}
