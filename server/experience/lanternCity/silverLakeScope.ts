/**
 * Which tenant book Silver Lake reads, and whose objective it serves.
 *
 * Laundry Farm is the company. Its CleanCloud customers live in the `laundry_farm` book, while the JOYSTICK front door
 * signs its owner in to `default` (Laundry Butler, whose own book has no Silver Lake customers). An operator who is an
 * active owner of `laundry_farm` therefore meets Laundry Farm's customers in Silver Lake: the roster, consent checks,
 * drafts and hand-offs all use that book, the same membership authority the read-only company view uses. The objective
 * (the area the operator asked to focus on) stays with the signed-in tenant under the operator's canonical identity;
 * only the area's orders are counted in the book Silver Lake reads. Nobody else is given another tenant's book.
 */
import { requireCanonicalOperatorIdentityForUser } from "../../agents/persistentOperator/identity";
import { LAUNDRY_FARM_TENANT_ID } from "../../analytics/laundryFarmCompanyView";
import { listActiveTenantMemberships } from "../../saas/tenantAccess";
import type { OutreachObjectiveScope } from "../../strategy/personalOutreachWrite";

export type SilverLakeScope = {
  /** The book Silver Lake's customers, consent, drafts and hand-offs come from. */
  tenantId: string;
  /** The signed-in operator, as drafts and hand-off records name them. */
  operatorId: string;
  /** Whose focus Silver Lake serves. */
  objective: OutreachObjectiveScope;
};

type SilverLakeUser = { id?: unknown; openId: string; role: "admin" | "driver" | "user" };

export type SilverLakeScopeDeps = {
  memberships: (openId: string) => Promise<Array<{ tenantId: string; role: string }>>;
  canonicalOperatorId: (input: { tenantId: string; user: SilverLakeUser }) => Promise<string>;
};

const defaultDeps: SilverLakeScopeDeps = {
  memberships: openId => listActiveTenantMemberships(openId),
  canonicalOperatorId: async ({ tenantId, user }) =>
    (await requireCanonicalOperatorIdentityForUser({ tenantId, user, subsystem: "silver_lake" })).canonicalOperatorId,
};

export async function resolveSilverLakeScope(
  ctx: { tenantId: string; user: SilverLakeUser },
  deps: SilverLakeScopeDeps = defaultDeps
): Promise<SilverLakeScope> {
  const [memberships, canonicalOperatorId] = await Promise.all([
    deps.memberships(ctx.user.openId).catch(() => []),
    // Goals and decisions are filed under the canonical operator identity, never the login id. Unresolvable, the
    // login id stands in and the objective reads as unavailable, as before.
    deps.canonicalOperatorId({ tenantId: ctx.tenantId, user: ctx.user }).catch(() => ctx.user.openId),
  ]);
  const ownsLaundryFarm = memberships.some(m => m.tenantId === LAUNDRY_FARM_TENANT_ID && m.role === "owner");
  return {
    tenantId: ownsLaundryFarm ? LAUNDRY_FARM_TENANT_ID : ctx.tenantId,
    operatorId: ctx.user.openId,
    objective: { tenantId: ctx.tenantId, canonicalOperatorId },
  };
}
