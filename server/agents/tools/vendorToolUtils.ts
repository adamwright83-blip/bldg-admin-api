import {
  createVendor,
  isVendorPublicBookingSlugTaken,
  updateVendorBranding,
  updateVendorSlug,
} from "../../db";
import { detectVendorCategoryPreset, getVendorCategoryPreset, vendorCategoryPresets, type VendorTrafficProtectionMode } from "../vendorCategoryPresets";
import crypto from "crypto";

export function slugify(value: string): string {
  return normalizeSlugCandidate(value) ?? "vendor";
}

const genericBookingHosts = new Set([
  "squareup.com",
  "book.squareup.com",
  "acuityscheduling.com",
  "vagaro.com",
  "styleseat.com",
  "fresha.com",
  "glossgenius.com",
  "calendly.com",
  "linktr.ee",
  "beacons.ai",
  "instagram.com",
]);

const badSlugParts = new Set([
  "www",
  "com",
  "vendor",
  "instagram",
  "vagaro",
  "styleseat",
  "fresha",
  "glossgenius",
  "book",
  "appointments",
  "appointment",
  "profile",
  "user",
  "m",
  "a",
]);

export function normalizeSlugCandidate(value: unknown): string | null {
  const normalized = String(value ?? "")
    .replace(/\b([A-Za-z])\.([A-Za-z])\./g, "$1$2")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  if (normalized.length < 3 || badSlugParts.has(normalized)) return null;
  return normalized;
}

function hostnameWithoutWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function rootDomainLabel(hostname: string): string | null {
  const host = hostnameWithoutWww(hostname);
  const parts = host.split(".").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length >= 2 && parts.at(-2) && !badSlugParts.has(parts.at(-2)!)) return parts.at(-2)!;
  return parts[0] ?? null;
}

function isGenericBookingHost(hostname: string): boolean {
  const host = hostnameWithoutWww(hostname);
  return Array.from(genericBookingHosts).some((genericHost) => host === genericHost || host.endsWith(`.${genericHost}`));
}

function bestPathSlug(url: URL): string | null {
  const segments = url.pathname.split("/").map((part) => part.trim()).filter(Boolean);
  for (const segment of segments) {
    const candidate = normalizeSlugCandidate(segment);
    if (candidate && !badSlugParts.has(candidate)) return candidate;
  }
  return null;
}

function slugFromPublicSource(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("@")) return normalizeSlugCandidate(raw.slice(1));

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    const host = hostnameWithoutWww(url.hostname);
    if (host === "instagram.com") return bestPathSlug(url);
    if (isGenericBookingHost(host)) return bestPathSlug(url);
    return normalizeSlugCandidate(rootDomainLabel(host));
  } catch {
    return null;
  }
}

function fallbackCategorySlug(input: Record<string, any>): string {
  const category = String(input.vendorCategory ?? input.categoryPresetKey ?? "vendor");
  const categorySlug = normalizeSlugCandidate(category) ?? "vendor";
  const suffix = crypto.randomBytes(2).toString("hex");
  return `${categorySlug}-${suffix}`.slice(0, 48).replace(/-+$/g, "");
}

export function generateVendorPublicBookingSlug(input: Record<string, any>): string {
  const fromName = normalizeSlugCandidate(input.businessName ?? input.name ?? input.brandName);
  if (fromName) return fromName;

  const fromSource =
    slugFromPublicSource(input.websiteOrInstagram) ??
    slugFromPublicSource(input.sourceUrl) ??
    slugFromPublicSource(input.bookingLink) ??
    slugFromPublicSource(input.instagram);
  if (fromSource) return fromSource;

  const email = String(input.email ?? "");
  const localPart = email.includes("@") ? email.split("@")[0] : "";
  const emailCandidate = normalizeSlugCandidate(localPart);
  if (emailCandidate && !["hello", "info", "contact", "admin", "booking", "bookings"].includes(emailCandidate)) {
    return emailCandidate;
  }

  return fallbackCategorySlug(input);
}

export async function generateUniqueVendorPublicBookingSlug(
  input: Record<string, any>,
  tenantId: string,
  excludeVendorId?: number | null
): Promise<string> {
  const base = generateVendorPublicBookingSlug(input);
  const isTaken = async (slug: string) => {
    if (typeof input.isSlugTaken === "function") return Boolean(await input.isSlugTaken(slug));
    return isVendorPublicBookingSlugTaken({ tenantId, slug, excludeVendorId });
  };
  if (!(await isTaken(base))) return base;

  for (let n = 2; n < 500; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 48 - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${base.slice(0, 43).replace(/-+$/g, "")}-${crypto.randomBytes(2).toString("hex")}`;
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
  const slug = await generateUniqueVendorPublicBookingSlug(
    { ...input, businessName: input.publicBookingSlug ?? input.slug ?? input.businessName ?? input.name },
    tenantId,
    vendorId
  );
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
  const publicBookingSlug = generateVendorPublicBookingSlug(input);
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
