import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { playgroundRules, type PlaygroundRule } from "../../drizzle/schema";
import { getDb } from "../db";

export const DEFAULT_APPROVAL_CATEGORIES = [
  "paid_ads",
  "print_order",
  "vendor_order",
  "customer_discount",
  "customer_refund",
  "other",
] as const;

export type ApprovalCategory = (typeof DEFAULT_APPROVAL_CATEGORIES)[number] | string;

export type ActivePlaygroundRules = {
  id: string;
  tenantId: string;
  version: number;
  monthlySpendCeilingCents: number;
  currency: string;
  approvalCategories: string[];
  effectiveFrom: string;
  effectiveTo: string | null;
  source: "operator_attested" | "admin";
  macroGoalId: string | null;
  status: "active" | "superseded";
};

// In-memory store for unit tests or when DB is not available
const inMemoryRules = new Map<string, ActivePlaygroundRules[]>();

export function getInMemoryRulesForTesting(tenantId: string): ActivePlaygroundRules | null {
  const list = inMemoryRules.get(tenantId) ?? [];
  return list.find(r => r.status === "active") ?? null;
}

export function resetInMemoryRulesForTesting(): void {
  inMemoryRules.clear();
}

export async function getActivePlaygroundRules(
  tenantId: string
): Promise<ActivePlaygroundRules> {
  const db = await getDb();
  if (db) {
    try {
      const [row] = await db
        .select()
        .from(playgroundRules)
        .where(
          and(
            eq(playgroundRules.tenantId, tenantId),
            eq(playgroundRules.status, "active")
          )
        )
        .orderBy(desc(playgroundRules.version))
        .limit(1);

      if (row) {
        return {
          id: row.id,
          tenantId: row.tenantId,
          version: row.version,
          monthlySpendCeilingCents: row.monthlySpendCeilingCents,
          currency: row.currency,
          approvalCategories: (row.approvalCategoriesJson as string[]) ?? [...DEFAULT_APPROVAL_CATEGORIES],
          effectiveFrom: row.effectiveFrom.toISOString(),
          effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString() : null,
          source: row.source,
          macroGoalId: row.macroGoalId ?? null,
          status: row.status,
        };
      }
    } catch {
      // Fall through to in-memory/default
    }
  }

  const mem = getInMemoryRulesForTesting(tenantId);
  if (mem) return mem;

  // Default playground rules: $0 ceiling, all categories require approval (G6)
  return {
    id: `default-${tenantId}`,
    tenantId,
    version: 1,
    monthlySpendCeilingCents: 0,
    currency: "USD",
    approvalCategories: [...DEFAULT_APPROVAL_CATEGORIES],
    effectiveFrom: new Date(0).toISOString(),
    effectiveTo: null,
    source: "admin",
    macroGoalId: null,
    status: "active",
  };
}

export async function setPlaygroundRules(input: {
  tenantId: string;
  monthlySpendCeilingCents: number;
  currency?: string;
  approvalCategories?: string[];
  source?: "operator_attested" | "admin";
  macroGoalId?: string | null;
}): Promise<ActivePlaygroundRules> {
  if (!Number.isFinite(input.monthlySpendCeilingCents) || input.monthlySpendCeilingCents < 0) {
    throw new Error("monthlySpendCeilingCents must be a non-negative finite number");
  }

  const current = await getActivePlaygroundRules(input.tenantId);
  const nextVersion = current.version + 1;
  const newId = randomUUID();
  const now = new Date();
  const categories = input.approvalCategories ?? [...DEFAULT_APPROVAL_CATEGORIES];
  const currency = input.currency ?? "USD";
  const source = input.source ?? "admin";
  const macroGoalId = input.macroGoalId ?? current.macroGoalId;

  const db = await getDb();
  if (db) {
    try {
      await db.transaction(async tx => {
        // Mark current active row as superseded
        await tx
          .update(playgroundRules)
          .set({
            status: "superseded",
            effectiveTo: now,
          })
          .where(
            and(
              eq(playgroundRules.tenantId, input.tenantId),
              eq(playgroundRules.status, "active")
            )
          );

        // Insert append-only new version
        await tx.insert(playgroundRules).values({
          id: newId,
          tenantId: input.tenantId,
          version: nextVersion,
          monthlySpendCeilingCents: input.monthlySpendCeilingCents,
          currency,
          approvalCategoriesJson: categories,
          effectiveFrom: now,
          effectiveTo: null,
          source,
          macroGoalId,
          status: "active",
        });
      });
    } catch {
      // If DB error, update in-memory
    }
  }

  // Update in-memory copy
  const list = inMemoryRules.get(input.tenantId) ?? [];
  for (const item of list) {
    if (item.status === "active") {
      item.status = "superseded";
      item.effectiveTo = now.toISOString();
    }
  }

  const newRule: ActivePlaygroundRules = {
    id: newId,
    tenantId: input.tenantId,
    version: nextVersion,
    monthlySpendCeilingCents: input.monthlySpendCeilingCents,
    currency,
    approvalCategories: categories,
    effectiveFrom: now.toISOString(),
    effectiveTo: null,
    source,
    macroGoalId,
    status: "active",
  };

  list.push(newRule);
  inMemoryRules.set(input.tenantId, list);
  return newRule;
}
