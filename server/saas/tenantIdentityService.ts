import { eq } from "drizzle-orm";
import { legacyDayforgeSaasTenants } from "../../drizzle/schema";
import { getDb } from "../db";

export type TenantBusinessIdentityRecord = {
  businessName: string | null;
  brandName: string | null;
};

export async function loadTenantBusinessIdentity(
  tenantId: string
): Promise<TenantBusinessIdentityRecord | null> {
  const scopedTenantId = tenantId.trim();
  if (!scopedTenantId) throw new Error("Tenant identity read requires tenant authority");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select({
      businessName: legacyDayforgeSaasTenants.businessName,
      brandName: legacyDayforgeSaasTenants.brandName,
    })
    .from(legacyDayforgeSaasTenants)
    .where(eq(legacyDayforgeSaasTenants.id, scopedTenantId))
    .limit(1);
  return row ?? null;
}
