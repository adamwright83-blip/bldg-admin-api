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
  WAYWARD_ROOK_CONTACT_CONSEQUENCE,
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
  grantSource: typeof WAYWARD_ROOK_CONTACT_CONSEQUENCE;
  grantedAt: Date;
}): Promise<void> {
  if (input.grantSource !== WAYWARD_ROOK_CONTACT_CONSEQUENCE) {
    throw new Error(
      "capability.rook.contact grantSource must be wayward.rook_contact_demonstrated"
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
      grantSource: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
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
