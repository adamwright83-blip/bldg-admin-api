/**
 * Whose objective Silver Lake serves.
 *
 * Silver Lake always works in the business the operator has selected (`ctx.tenantId`): customers, consent, drafts and
 * hand-offs all belong to that tenant, and owning another business never redirects to it. Goals and focus decisions are
 * filed under the operator's canonical identity (`tenant:<tenant>:operator:<openId>`), not the login id, so the objective
 * is read under that identity. Drafts and hand-off records keep naming the signed-in login id, as before.
 */
import { requireCanonicalOperatorIdentityForUser } from "../../agents/persistentOperator/identity";

type SilverLakeUser = { id?: unknown; openId: string; role: "admin" | "driver" | "user" };

export type SilverLakeOperatorResolver = (input: { tenantId: string; user: SilverLakeUser }) => Promise<string>;

const resolveCanonical: SilverLakeOperatorResolver = async ({ tenantId, user }) =>
  (await requireCanonicalOperatorIdentityForUser({ tenantId, user, subsystem: "silver_lake" })).canonicalOperatorId;

/** The operator's canonical identity in the selected business. Unresolvable, the login id stands in, as before. */
export async function silverLakeOperatorId(
  ctx: { tenantId: string; user: SilverLakeUser },
  resolve: SilverLakeOperatorResolver = resolveCanonical
): Promise<string> {
  return resolve({ tenantId: ctx.tenantId, user: ctx.user }).catch(() => ctx.user.openId);
}
