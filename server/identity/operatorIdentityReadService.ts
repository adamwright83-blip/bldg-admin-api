import { getUserByOpenId } from "../db";

export type PersistedOperatorIdentity = {
  userId: number;
  tenantId: string;
  /** The persisted display name, if any. Spoken by Claire as a first name. */
  name: string | null;
};

export async function loadPersistedOperatorIdentity(
  openIdInput: string
): Promise<PersistedOperatorIdentity | null> {
  const openId = openIdInput.trim();
  if (!openId) throw new Error("Operator identity read requires openId");

  const user = await getUserByOpenId(openId);
  if (!user || user.id == null) return null;

  const userId = Number(user.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;

  return {
    userId,
    tenantId: user.tenantId?.trim() || "default",
    name: typeof user.name === "string" && user.name.trim() ? user.name.trim() : null,
  };
}
