/**
 * The one CleanCloud service classifier. The Laundry Farm revenue sheet sync
 * ("LF Laundry Rev" / "LF Dry Clean Rev") and the paid-order ledger both read
 * CleanCloud's order summary through this, so "dry-cleaning sales" means the
 * same thing in the sheet, Admin analytics, and Claire.
 */

export type LaundryFarmServiceClass = "laundry" | "dry_cleaning" | "mixed_needs_review" | "unknown_needs_review";

export const LAUNDRY_FARM_LAUNDRY_CATALOG = [
  "Fluff & Fold SAME DAY / DELIVERY",
  "Wash & fold",
  "Wash, Fold & Dry",
  "Fluff & Fold",
  "Bedding & Rugs",
  "Rug - Extra Large",
  "Alfombra extra grande",
  "Rug - Large",
  "Alfombra grande",
  "Rug - Small",
  "Alfombra pequeña",
  "Sheets (1)",
  "Sábanas",
  "Sleeping Bag",
  "Saco de dormir",
  "All Comforters",
  "Comforter",
] as const;

export function normalizeCleanCloudServiceName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const normalizedLaundryCatalog = LAUNDRY_FARM_LAUNDRY_CATALOG.map(normalizeCleanCloudServiceName);

function stripCleanCloudQuantitySuffix(value: string): string {
  return value
    .replace(/\s+x\s+[-+]?\d+(?:\.\d+)?\s*$/i, "")
    .replace(/\s+\d+(?:\.\d+)?\s*(?:lb|lbs|pound|pounds)\s*$/i, "")
    .trim();
}

export function cleanCloudServiceLines(summaryText: string | null): string[] {
  return String(summaryText ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/\n+/)
    .map(line => line.trim())
    .filter(
      line =>
        line &&
        !/^discount\b/i.test(line) &&
        !/^credit\b/i.test(line) &&
        !/^\d+(?:\.\d+)?\s*(?:lb|lbs|pound|pounds)$/i.test(line)
    )
    .map(stripCleanCloudQuantitySuffix)
    .filter(line => line && normalizeCleanCloudServiceName(line) !== "dry");
}

function isLaundryCatalogService(value: string): boolean {
  const normalized = normalizeCleanCloudServiceName(value);
  if (!normalized) return false;
  return normalizedLaundryCatalog.some(catalogItem => normalized === catalogItem || normalized.includes(catalogItem));
}

export function classifyCleanCloudService(order: {
  summaryText?: string | null;
  rawJson?: unknown | null;
}): LaundryFarmServiceClass {
  const raw = order.rawJson as Record<string, unknown> | null;
  const lines = cleanCloudServiceLines(order.summaryText ?? (typeof raw?.Summary === "string" ? raw.Summary : null));
  if (!lines.length) return "unknown_needs_review";

  const hasLaundry = lines.some(isLaundryCatalogService);
  const hasDryCleaning = lines.some(line => !isLaundryCatalogService(line));
  if (hasLaundry && hasDryCleaning) return "mixed_needs_review";
  if (hasLaundry) return "laundry";
  return "dry_cleaning";
}
