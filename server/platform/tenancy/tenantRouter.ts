import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { inArray, eq } from "drizzle-orm";
import { legacyDayforgeSaasTenants } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { protectedProcedure, router } from "../../_core/trpc";
import { getSessionCookieOptions } from "../../_core/cookies";
import { JOYSTICK_ACTIVE_TENANT_COOKIE } from "../../_core/context";
import { isLegacyDayforgeTenant, listActiveTenantMemberships } from "../../saas/tenantAccess";
import { isPlatformAdministrator } from "./tenantIdentity";

export type TenantSummary = {
  id: string;
  businessName: string;
  brandName: string;
  slug: string;
  primaryColor: string;
  logoUrl: string | null;
  role: string;
  isCurrent?: boolean;
};

const DEFAULT_TENANT_FALLBACKS: Record<string, Omit<TenantSummary, "role" | "isCurrent">> = {
  default: {
    id: "default",
    businessName: "Laundry Butler",
    brandName: "Laundry Butler",
    slug: "laundry-butler",
    primaryColor: "#2563EB",
    logoUrl: null,
  },
  laundry_farm: {
    id: "laundry_farm",
    businessName: "Laundry Farm",
    brandName: "Laundry Farm",
    slug: "laundry-farm",
    primaryColor: "#1B4D3E",
    logoUrl:
      "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/TnWYaeVttBiuZTNp.png",
  },
};

export async function resolveAccessibleTenantIdsForUser(user: {
  openId: string;
  role: "admin" | "driver" | "user";
  tenantId?: string | null;
}): Promise<Map<string, string>> {
  const accessible = new Map<string, string>(); // tenantId -> role

  // Platform admin or admin role has implicit access to legacy Dayforge tenants
  if (user.role === "admin" || isPlatformAdministrator(user)) {
    accessible.set("default", "owner");
    accessible.set("laundry_farm", "owner");
  }

  // Persisted user tenant
  if (user.tenantId?.trim()) {
    accessible.set(user.tenantId.trim(), user.role);
  }

  // Active SaaS memberships
  try {
    const memberships = await listActiveTenantMemberships(user.openId);
    for (const m of memberships) {
      accessible.set(m.tenantId, m.role);
    }
  } catch {
    // DB lookup error falls back to implicit roles
  }

  return accessible;
}

export const tenantRouter = router({
  getActiveTenant: protectedProcedure.query(async ({ ctx }): Promise<TenantSummary> => {
    const db = await getDb();
    let tenantRow: typeof legacyDayforgeSaasTenants.$inferSelect | undefined;

    if (db) {
      try {
        const rows = await db
          .select()
          .from(legacyDayforgeSaasTenants)
          .where(eq(legacyDayforgeSaasTenants.id, ctx.tenantId))
          .limit(1);
        tenantRow = rows[0];
      } catch {
        tenantRow = undefined;
      }
    }

    const fallback = DEFAULT_TENANT_FALLBACKS[ctx.tenantId];
    return {
      id: ctx.tenantId,
      businessName:
        tenantRow?.businessName ||
        fallback?.businessName ||
        (ctx.tenantId === "laundry_farm" ? "Laundry Farm" : "Laundry Butler"),
      brandName:
        tenantRow?.brandName ||
        tenantRow?.businessName ||
        fallback?.brandName ||
        (ctx.tenantId === "laundry_farm" ? "Laundry Farm" : "Laundry Butler"),
      slug:
        tenantRow?.slug ||
        fallback?.slug ||
        (ctx.tenantId === "laundry_farm" ? "laundry-farm" : "laundry-butler"),
      primaryColor:
        tenantRow?.primaryColor ||
        fallback?.primaryColor ||
        (ctx.tenantId === "laundry_farm" ? "#1B4D3E" : "#2563EB"),
      logoUrl: tenantRow?.logoUrl ?? fallback?.logoUrl ?? null,
      role: ctx.user.role,
    };
  }),

  listAccessibleTenants: protectedProcedure.query(
    async ({ ctx }): Promise<TenantSummary[]> => {
      const accessibleMap = await resolveAccessibleTenantIdsForUser(ctx.user);
      const tenantIds = Array.from(accessibleMap.keys());
      if (tenantIds.length === 0) {
        return [];
      }

      const db = await getDb();
      const tenantRows = new Map<string, typeof legacyDayforgeSaasTenants.$inferSelect>();
      if (db) {
        try {
          const rows = await db
            .select()
            .from(legacyDayforgeSaasTenants)
            .where(inArray(legacyDayforgeSaasTenants.id, tenantIds));
          for (const row of rows) {
            tenantRows.set(row.id, row);
          }
        } catch {
          // fallback to defaults if query fails
        }
      }

      return tenantIds.map(id => {
        const row = tenantRows.get(id);
        const fallback = DEFAULT_TENANT_FALLBACKS[id];
        const role = accessibleMap.get(id) || ctx.user.role;
        return {
          id,
          businessName:
            row?.businessName ||
            fallback?.businessName ||
            (id === "laundry_farm" ? "Laundry Farm" : id === "default" ? "Laundry Butler" : id),
          brandName:
            row?.brandName ||
            row?.businessName ||
            fallback?.brandName ||
            (id === "laundry_farm" ? "Laundry Farm" : id === "default" ? "Laundry Butler" : id),
          slug:
            row?.slug ||
            fallback?.slug ||
            (id === "laundry_farm" ? "laundry-farm" : id === "default" ? "laundry-butler" : id),
          primaryColor:
            row?.primaryColor ||
            fallback?.primaryColor ||
            (id === "laundry_farm" ? "#1B4D3E" : "#2563EB"),
          logoUrl: row?.logoUrl ?? fallback?.logoUrl ?? null,
          role,
          isCurrent: id === ctx.tenantId,
        };
      });
    }
  ),

  switchActiveTenant: protectedProcedure
    .input(z.object({ tenantId: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const accessibleMap = await resolveAccessibleTenantIdsForUser(ctx.user);
      if (!accessibleMap.has(input.tenantId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `User is not authorized for tenant "${input.tenantId}"`,
        });
      }

      if (ctx.res && typeof ctx.res.cookie === "function") {
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(JOYSTICK_ACTIVE_TENANT_COOKIE, input.tenantId, {
          ...cookieOptions,
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });
      }

      return {
        success: true,
        activeTenantId: input.tenantId,
      };
    }),
});
