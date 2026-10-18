import { and, eq, inArray } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { persistentOperatorIdentityBindings } from "../../../drizzle/schema";
import {
  applySalesHoldInstruction,
  salesHeldOn,
  type SalesHoldInstruction,
} from "../../../shared/claireProactive";
import { getDb } from "../../db";
import { isMysqlMissingTableError } from "../../mysqlErrors";
import { resolveOperatorTimeZone } from "./operatorAppointmentPolicy";
import { loadOperatorDoctrine, loadOperatorSalesHold, saveOperatorDoctrine } from "./operatorDoctrineStore";

/**
 * Every open id of the operator who spoke: the canonical id and its active
 * aliases. A hold may be saved under any of them, and every planner reads all
 * of them, so a change must reach them all. A read only: unlike full identity
 * resolution it records nothing, so the minute-by-minute board sweep can call it.
 */
async function operatorOpenIds(tenantId: string, operatorUserId: string): Promise<string[]> {
  const db = await getDb();
  if (!db) return [operatorUserId];
  const b = persistentOperatorIdentityBindings;
  const active = (column: typeof b.aliasOpenId | typeof b.canonicalOpenId, values: string[]) =>
    and(eq(b.tenantId, tenantId), eq(b.active, true), inArray(column, values));
  try {
    const canonical = [
      operatorUserId,
      ...(await db.select({ id: b.canonicalOpenId }).from(b).where(active(b.aliasOpenId, [operatorUserId]))).map(r => r.id),
    ];
    const aliases = (await db.select({ id: b.aliasOpenId }).from(b).where(active(b.canonicalOpenId, canonical))).map(r => r.id);
    return [...new Set([...canonical, ...aliases])];
  } catch (error) {
    if (isMysqlMissingTableError(error)) return [operatorUserId];
    throw error;
  }
}

/** The operator's hold across every open id, for a caller holding only one. */
export async function loadOperatorSalesHoldFor(input: { tenantId: string; operatorUserId: string }) {
  return loadOperatorSalesHold({ tenantId: input.tenantId, operatorUserIds: await operatorOpenIds(input.tenantId, input.operatorUserId) });
}

/** Today in the business's own time zone. */
export async function operatorBusinessDate(tenantId: string, now: Date, fallbackTimeZone: string): Promise<string> {
  return formatInTimeZone(now, (await resolveOperatorTimeZone(tenantId)) ?? fallbackTimeZone, "yyyy-MM-dd");
}

/**
 * Records an operator's spoken sales hold, or its release, and returns what
 * Claire says. Only operator-authenticated surfaces call this: the signed-in
 * app, Desk Comms, and the operator's own Claire line. Nothing autonomous
 * sets or lifts a hold.
 *
 * The hold is dated on the business day it was said, in the business's own
 * time zone. The latest instruction wins: a new hold replaces any same-day
 * hold under the operator's other open ids, and "resume sales" clears them
 * all. Lifting a hold starts nothing; held work returns only as a proposal.
 */
export async function recordOperatorSalesHoldInstruction(input: {
  tenantId: string;
  operatorUserId: string;
  instruction: SalesHoldInstruction;
  utterance: string;
  now: Date;
  /** The business date, when the caller already holds it in the business's time zone. */
  businessDate?: string;
  /** Used only when the tenant has no configured time zone. */
  fallbackTimeZone: string;
}): Promise<string> {
  const businessDate = input.businessDate ?? (await operatorBusinessDate(input.tenantId, input.now, input.fallbackTimeZone));
  const apply = (rules: Parameters<typeof applySalesHoldInstruction>[0], instruction: SalesHoldInstruction) =>
    applySalesHoldInstruction(rules, instruction, { businessDate, utterance: input.utterance, now: input.now });

  let speak: string | null = null;
  for (const operatorUserId of await operatorOpenIds(input.tenantId, input.operatorUserId)) {
    const rules = await loadOperatorDoctrine({ tenantId: input.tenantId, operatorUserId });
    const speaker = operatorUserId === input.operatorUserId;
    if (input.instruction.kind === "hold" && !speaker && !salesHeldOn(rules, businessDate)) continue;
    // The speaker's doctrine takes the hold; another id's same-day hold is superseded by it.
    const applied = apply(rules, input.instruction.kind === "hold" && !speaker ? { kind: "resume" } : input.instruction);
    if (!applied.changed) continue;
    await saveOperatorDoctrine({ tenantId: input.tenantId, operatorUserId, rules: applied.rules });
    if (speaker || input.instruction.kind === "resume") speak ??= applied.speak;
  }
  return speak ?? "Sales work isn't on hold, so nothing changed.";
}
