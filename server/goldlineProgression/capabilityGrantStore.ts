/**
 * Durable capability.rook.contact grants.
 *
 * Authority is goldline_domain_capability_grants, created by scripts/migrate.mjs.
 * This module does not create the table and does not backfill operators.
 * Companion unlocks and Rook ownership are not read here.
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { goldlineDomainCapabilityGrants } from "../../drizzle/schema";
import {
  ROOK_CONTACT_CAPABILITY_ID,
  ROOK_CONTACT_ISOLATED_PREVIEW_GRANT_SOURCE,
  ROOK_CONTACT_WAYWARD_GATE_GRANT_SOURCE,
} from "../../shared/rookContact";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError, isMysqlMissingTableError } from "../mysqlErrors";
import { ProgressionSchemaBlockedError } from "./progressionContract";

export type RookContactGrant = {
  capabilityId: typeof ROOK_CONTACT_CAPABILITY_ID;
  grantedAt: Date;
  grantSource: string;
};

export type RookContactGrantLookup =
  | { readable: true; grant: RookContactGrant | null }
  | { readable: false };

function isGrantReadFailure(error: unknown): boolean {
  if (isMysqlMissingTableError(error)) return true;
  const message = error instanceof Error ? error.message : "";
  return /goldline_domain_capability_grants|unexpected table/i.test(message);
}

/**
 * Missing table, failed read, or no database is unreadable.
 * A missing row is readable and ungranted. Companion unlocks are not consulted.
 */
export async function findRookContactGrant(input: {
  tenantId: string;
  operatorId: string;
}): Promise<RookContactGrantLookup> {
  try {
    const db = await getDb();
    if (!db) return { readable: false };
    const [row] = await db
      .select({
        capabilityId: goldlineDomainCapabilityGrants.capabilityId,
        grantedAt: goldlineDomainCapabilityGrants.grantedAt,
        grantSource: goldlineDomainCapabilityGrants.grantSource,
      })
      .from(goldlineDomainCapabilityGrants)
      .where(
        and(
          eq(goldlineDomainCapabilityGrants.tenantId, input.tenantId),
          eq(goldlineDomainCapabilityGrants.operatorId, input.operatorId),
          eq(goldlineDomainCapabilityGrants.capabilityId, ROOK_CONTACT_CAPABILITY_ID)
        )
      )
      .limit(1);
    if (!row || row.capabilityId !== ROOK_CONTACT_CAPABILITY_ID || !row.grantedAt) {
      return { readable: true, grant: null };
    }
    return {
      readable: true,
      grant: {
        capabilityId: ROOK_CONTACT_CAPABILITY_ID,
        grantedAt: row.grantedAt,
        grantSource: row.grantSource,
      },
    };
  } catch (error) {
    if (isGrantReadFailure(error)) return { readable: false };
    throw error;
  }
}

/**
 * Idempotent insert of capability.rook.contact. A second call keeps the
 * original grantedAt and grantSource. No other capability id is stored.
 */
export async function grantRookContactCapability(input: {
  tenantId: string;
  operatorId: string;
  grantSource:
    | typeof ROOK_CONTACT_ISOLATED_PREVIEW_GRANT_SOURCE
    | typeof ROOK_CONTACT_WAYWARD_GATE_GRANT_SOURCE;
  grantedAt: Date;
}): Promise<void> {
  const productionWayward =
    input.grantSource === ROOK_CONTACT_WAYWARD_GATE_GRANT_SOURCE;
  const isolatedPreview =
    input.grantSource === ROOK_CONTACT_ISOLATED_PREVIEW_GRANT_SOURCE;
  if (!productionWayward && !isolatedPreview) {
    throw new Error(
      "capability.rook.contact refuses client and replacement grant sources"
    );
  }
  if (process.env.NODE_ENV === "production" && !productionWayward) {
    throw new Error(
      "capability.rook.contact preview grant is not production authority"
    );
  }
  const existing = await findRookContactGrant(input);
  if (!existing.readable) {
    throw new ProgressionSchemaBlockedError(
      "goldline_domain_capability_grants is not readable"
    );
  }
  if (existing.grant) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.insert(goldlineDomainCapabilityGrants).values({
      id: randomUUID(),
      tenantId: input.tenantId,
      operatorId: input.operatorId,
      capabilityId: ROOK_CONTACT_CAPABILITY_ID,
      grantedAt: input.grantedAt,
      grantSource: input.grantSource,
    });
  } catch (error) {
    if (isMysqlDuplicateKeyError(error)) return;
    if (isMysqlMissingTableError(error)) {
      throw new ProgressionSchemaBlockedError(
        "goldline_domain_capability_grants is not present"
      );
    }
    throw error;
  }
}
