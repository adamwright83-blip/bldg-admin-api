import {
  createVendor,
  updateVendorBranding,
  updateVendorSlug,
} from "../../db";
import { detectVendorCategoryPreset, getVendorCategoryPreset, vendorCategoryPresets, type VendorTrafficProtectionMode } from "../vendorCategoryPresets";

export function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "vendor";
}

export function cents(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Math.round(value);
  const parsed = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * (parsed > 999 ? 1 : 100)) : fallback;
}

export function normalizeServiceModel(value: unknown): "mobile" | "fixed_location" | "both" {
  const raw = String(value ?? "").toLowerCase();
  if (raw.includes("both")) return "both";
  if (raw.includes("fixed") || raw.includes("come to me") || raw.includes("location")) return "fixed_location";
  return "mobile";
}

export function normalizeTrafficMode(value: unknown): VendorTrafficProtectionMode {
  const raw = String(value ?? "").toLowerCase();
  if (raw.includes("back")) return "back_to_back";
  if (raw.includes("breath") || raw.includes("reset")) return "breathing_room";
  return "geo_clustered";
}

export function inferCategoryKey(input: Record<string, any>): string {
  const explicit = input.categoryPresetKey ?? input.vendorCategory;
  if (explicit && String(explicit) in vendorCategoryPresets) return String(explicit);
  return detectVendorCategoryPreset(String(explicit ?? JSON.stringify(input)));
}

export function missingVendorFields(input: Record<string, any>): string[] {
  const required = [
    "businessName",
    "vendorCategory",
    "contactName",
    "phone",
    "email",
    "services",
    "serviceModel",
    "serviceArea",
    "availability",
    "bookingConfirmationMode",
  ];
  return required.filter((field) => {
    const value = input[field];
    return value == null || value === "" || (Array.isArray(value) && value.length === 0);
  });
}

export async function ensureVendor(input: Record<string, any>, tenantId: string): Promise<number> {
  if (input.vendorId != null) return Number(input.vendorId);
  const name = String(input.businessName ?? input.name ?? "Draft Vendor");
  const vendorId = await createVendor({
    name,
    email: input.email ?? null,
    country: input.country ?? "US",
    platformFeePercent: input.platformFeePercent ?? null,
  });
  const slug = slugify(String(input.publicBookingSlug ?? input.slug ?? name));
  await updateVendorSlug(vendorId, slug);
  if (input.brandName || input.brandLogoUrl || input.logoUrl) {
    await updateVendorBranding(vendorId, {
      brandName: input.brandName ?? name,
      logoUrl: input.brandLogoUrl ?? input.logoUrl ?? null,
    });
  }
  void tenantId;
  return vendorId;
}

export function buildAdminConfig(input: Record<string, any>) {
  const categoryPresetKey = inferCategoryKey(input);
  const preset = getVendorCategoryPreset(categoryPresetKey);
  const publicBookingSlug = slugify(String(input.publicBookingSlug ?? input.brandName ?? input.businessName ?? "vendor"));
  return {
    categoryPresetKey: preset.internalCategoryKey,
    themeKey: input.themeKey ?? input.preferredTheme ?? preset.defaultAdminTheme,
    enabledSurfacesJson: input.enabledSurfaces ?? preset.enabledAdminSurfaces,
    navConfigJson: {
      enabledOnly: true,
      surfaces: input.enabledSurfaces ?? preset.enabledAdminSurfaces,
    },
    brandConfigJson: {
      brandName: input.brandName ?? input.businessName ?? null,
      brandLogoUrl: input.brandLogoUrl ?? input.logoUrl ?? null,
      brandAccentColor: input.brandAccentColor ?? null,
    },
    externalBookingBrandMode: input.externalBookingBrandMode ?? "vendor_primary",
    publicBookingSlug,
    customDomain: input.customDomain ?? null,
    customDomainStatus: input.customDomain ? "pending_dns" : "not_configured",
    brandName: input.brandName ?? input.businessName ?? null,
    brandLogoUrl: input.brandLogoUrl ?? input.logoUrl ?? null,
    brandAccentColor: input.brandAccentColor ?? null,
  };
}
