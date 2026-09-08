import { ENV } from "../_core/env";
import { getUserByOpenId } from "../db";

export type NightShiftAutonomousScope = {
  tenantId: string;
  operatorId: string;
  userId: string;
};

/**
 * Goldline autonomous Night Shift uses the sanctioned owner identity already
 * used elsewhere in production auth (`OWNER_OPEN_ID`). Fail closed when that
 * identity cannot be resolved to a real user row.
 */
export async function resolveAutonomousNightShiftScope(): Promise<NightShiftAutonomousScope | null> {
  const operatorId = ENV.ownerOpenId.trim();
  if (!operatorId) return null;
  const user = await getUserByOpenId(operatorId);
  if (!user?.id) return null;
  return {
    tenantId: user.tenantId ?? "default",
    operatorId,
    userId: String(user.id),
  };
}
