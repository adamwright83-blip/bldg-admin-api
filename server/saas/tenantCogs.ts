/* LEGACY DAYFORGE COMPATIBILITY: retained historical table/config literals only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { eq } from "drizzle-orm";
import {
  legacyDayforgeSaasBillingPlans,
  legacyDayforgeSaasSubscriptions,
} from "../../drizzle/schema";
import {
  currentAiUsageMonth,
  getDb,
  incrementTenantProviderUsage,
  listTenantProviderUsage,
} from "../db";

export type ProviderBudget = {
  warningCents: number | null;
  hardCents: number | null;
};

export type TenantUsagePolicy = {
  tenantId: string;
  planKey: string | null;
  ai: ProviderBudget;
  totalCogs: ProviderBudget;
  providers: Record<string, ProviderBudget>;
};

type PlanRules = {
  usageBudgets?: {
    aiWarningCents?: unknown;
    aiHardCents?: unknown;
    totalWarningCents?: unknown;
    totalHardCents?: unknown;
    providers?: Record<
      string,
      { warningCents?: unknown; hardCents?: unknown } | null | undefined
    >;
  };
};

function cents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}

function fallbackWarning(): number {
  return Math.max(0, Number(process.env.AI_WARNING_LIMIT_CENTS ?? 5000) || 0);
}

function fallbackHard(): number {
  return Math.max(0, Number(process.env.AI_HARD_LIMIT_CENTS ?? 10000) || 0);
}

function normalizeProviderBudgets(
  input: PlanRules["usageBudgets"]
): Record<string, ProviderBudget> {
  const result: Record<string, ProviderBudget> = {};
  for (const [provider, raw] of Object.entries(input?.providers ?? {})) {
    if (!raw) continue;
    result[provider] = {
      warningCents: cents(raw.warningCents),
      hardCents: cents(raw.hardCents),
    };
  }
  return result;
}

export async function resolveTenantUsagePolicy(
  tenantId: string
): Promise<TenantUsagePolicy> {
  if (!tenantId.trim()) throw new Error("tenantId is required");
  const db = await getDb();
  const fallback: TenantUsagePolicy = {
    tenantId,
    planKey: null,
    ai: {
      warningCents: fallbackWarning(),
      hardCents: fallbackHard(),
    },
    totalCogs: {
      warningCents: null,
      hardCents: null,
    },
    providers: {},
  };
  if (!db) return fallback;

  const [subscription] = await db
    .select({ planKey: legacyDayforgeSaasSubscriptions.planKey })
    .from(legacyDayforgeSaasSubscriptions)
    .where(eq(legacyDayforgeSaasSubscriptions.tenantId, tenantId))
    .limit(1);
  if (!subscription) return fallback;

  const [plan] = await db
    .select({
      planKey: legacyDayforgeSaasBillingPlans.planKey,
      rulesJson: legacyDayforgeSaasBillingPlans.rulesJson,
    })
    .from(legacyDayforgeSaasBillingPlans)
    .where(eq(legacyDayforgeSaasBillingPlans.planKey, subscription.planKey))
    .limit(1);
  if (!plan) return { ...fallback, planKey: subscription.planKey };

  const rules = (plan.rulesJson ?? {}) as PlanRules;
  const usage = rules.usageBudgets;
  return {
    tenantId,
    planKey: plan.planKey,
    ai: {
      warningCents: cents(usage?.aiWarningCents) ?? fallbackWarning(),
      hardCents: cents(usage?.aiHardCents) ?? fallbackHard(),
    },
    totalCogs: {
      warningCents: cents(usage?.totalWarningCents),
      hardCents: cents(usage?.totalHardCents),
    },
    providers: normalizeProviderBudgets(usage),
  };
}

export function providerBudgetFor(
  policy: TenantUsagePolicy,
  provider: string
): ProviderBudget {
  return policy.providers[provider] ?? {
    warningCents: policy.totalCogs.warningCents,
    hardCents: policy.totalCogs.hardCents,
  };
}

export async function recordTenantProviderCost(input: {
  tenantId: string;
  provider: string;
  category: string;
  usageUnit: string;
  usageQuantity: number;
  estimatedCostCents: number;
  month?: string;
}) {
  if (!input.tenantId.trim()) throw new Error("tenantId is required");
  if (!input.provider.trim()) throw new Error("provider is required");
  if (!input.category.trim()) throw new Error("category is required");
  const policy = await resolveTenantUsagePolicy(input.tenantId);
  const budget = providerBudgetFor(policy, input.provider);
  return incrementTenantProviderUsage({
    ...input,
    warningLimitCents: budget.warningCents,
    hardLimitCents: budget.hardCents,
  });
}

export async function getTenantMonthlyCogs(
  tenantId: string,
  month = currentAiUsageMonth()
) {
  const [policy, rows] = await Promise.all([
    resolveTenantUsagePolicy(tenantId),
    listTenantProviderUsage(tenantId, month),
  ]);
  const estimatedCostCents = rows.reduce(
    (sum, row) => sum + Number(row.estimatedCostCents ?? 0),
    0
  );
  return {
    tenantId,
    month,
    planKey: policy.planKey,
    estimatedCostCents,
    warningLimitCents: policy.totalCogs.warningCents,
    hardLimitCents: policy.totalCogs.hardCents,
    warning:
      policy.totalCogs.warningCents != null &&
      estimatedCostCents >= policy.totalCogs.warningCents,
    hardLimitReached:
      policy.totalCogs.hardCents != null &&
      estimatedCostCents >= policy.totalCogs.hardCents,
    providers: rows,
  };
}
