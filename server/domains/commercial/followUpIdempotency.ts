/**
 * A follow-up is idempotent on (account, follow-up kind), not only on its request id.
 *
 * Production 2026-09-27/28: two open follow-ups for "Los Feliz Towers" ("email him with collateral",
 * "Email him the collateral") on pipelines 15 and 17 (two account rows, one name). Their request ids
 * differed, so the unique index let both in, and both were read aloud on every call. Before inserting,
 * the writers ask whether an OPEN follow-up of the same kind already exists for an account of the same
 * name in this tenant, and reuse it instead of creating a second one.
 */
import { and, eq } from "drizzle-orm";
import { commercialAccounts, commercialFollowUps, commercialPipelineRecords } from "../../../drizzle/schema";
import type { getDb } from "../../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type FollowUpReader = Pick<Db, "select">;

const KIND_STOP = new Set(["the", "a", "an", "to", "with", "for", "about", "him", "her", "them", "his", "their", "of", "and", "up", "on", "in", "at", "this", "that", "it"]);

/** "email him with collateral" and "Email him the collateral" are the same kind of follow-up. */
export function followUpKind(note: string | null | undefined): string {
  return (note ?? "")
    .toLowerCase()
    .replace(/operator report \(hearsay kept as hearsay\):/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(token => token && !KIND_STOP.has(token))
    .join(" ");
}

export function sameFollowUpKind(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = followUpKind(a);
  const right = followUpKind(b);
  if (!left && !right) return true; // two bare follow-ups with no note are the same generic kind
  return left === right;
}

export function normalizeAccountName(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** The open follow-up of the same kind on an account with the same name, if any. */
export async function findOpenFollowUpOfKind(
  reader: FollowUpReader,
  input: { tenantId: string; pipelineId: number; note: string | null | undefined }
): Promise<{ id: string; pipelineId: number; dueAt: Date; note: string | null } | null> {
  const own = await reader
    .select({ name: commercialAccounts.name })
    .from(commercialPipelineRecords)
    .innerJoin(commercialAccounts, eq(commercialAccounts.id, commercialPipelineRecords.accountId))
    .where(and(eq(commercialPipelineRecords.tenantId, input.tenantId), eq(commercialPipelineRecords.id, input.pipelineId)))
    .limit(1);
  const accountName = own[0]?.name;
  if (!accountName) return null;
  const wanted = normalizeAccountName(accountName);
  const open = await reader
    .select({
      id: commercialFollowUps.id,
      pipelineId: commercialFollowUps.pipelineId,
      dueAt: commercialFollowUps.dueAt,
      note: commercialFollowUps.note,
      accountName: commercialAccounts.name,
    })
    .from(commercialFollowUps)
    .innerJoin(commercialPipelineRecords, eq(commercialPipelineRecords.id, commercialFollowUps.pipelineId))
    .innerJoin(commercialAccounts, eq(commercialAccounts.id, commercialPipelineRecords.accountId))
    .where(and(eq(commercialFollowUps.tenantId, input.tenantId), eq(commercialFollowUps.status, "open")));
  const match = open.find(row => normalizeAccountName(row.accountName) === wanted && sameFollowUpKind(row.note, input.note));
  return match ? { id: match.id, pipelineId: match.pipelineId, dueAt: match.dueAt, note: match.note } : null;
}
