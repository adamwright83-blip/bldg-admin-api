import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { centsToDollars } from "@shared/pricing";

type Variant = "butler" | "laundryfarm";

/**
 * Marketing / dry-clean flows: garment SKUs only. Matches admin Intake DC grid (excludes wash_fold catalog lines).
 */
export function isCatalogRowDryCleanOrAlteration(row: { serviceType?: string | null }): boolean {
  const st = row.serviceType ?? "dry_clean";
  return st === "dry_clean" || st === "alteration";
}

/**
 * Resident-facing dry-clean list from catalog.getActiveCatalog (runtime DB, tenant from host).
 */
export function CatalogDryCleanPricing({
  variant = "butler",
  className = "",
  maxHeightClass = "max-h-[220px]",
}: {
  variant?: Variant;
  className?: string;
  /** Scroll area for long menus */
  maxHeightClass?: string;
}) {
  const { data, isLoading, isError } = trpc.catalog.getActiveCatalog.useQuery();

  const dryCleanRows = useMemo(
    () => (data ?? []).filter(isCatalogRowDryCleanOrAlteration),
    [data]
  );

  const byCategory = useMemo(() => {
    if (!dryCleanRows.length) return [] as [string, typeof dryCleanRows][];
    const m = new Map<string, typeof dryCleanRows>();
    for (const row of dryCleanRows) {
      const c = row.category || "Other";
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(row);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [dryCleanRows]);

  const minFrom = useMemo(() => {
    if (!dryCleanRows.length) return null;
    return Math.min(...dryCleanRows.map((r) => r.standardPriceCents));
  }, [dryCleanRows]);

  if (isLoading) {
    return (
      <div className={`text-sm text-black/40 ${className}`} aria-busy="true">
        Loading prices…
      </div>
    );
  }

  if (isError || !dryCleanRows.length) {
    return null;
  }

  const isLf = variant === "laundryfarm";

  return (
    <div className={className}>
      {minFrom != null && (
        <p
          className={`mb-2 text-sm ${isLf ? "text-[#6b7280]" : "text-black/65"}`}
          style={isLf ? { fontFamily: "'DM Sans', system-ui, sans-serif" } : undefined}
        >
          Garments from <strong>${centsToDollars(minFrom)}</strong> — full menu below.
        </p>
      )}
      <div
        className={`overflow-y-auto rounded-md border ${maxHeightClass} ${
          isLf ? "border-[rgba(26,58,42,0.08)] bg-white/80" : "border-black/15 bg-white/60"
        }`}
      >
        <div className="divide-y divide-black/5">
          {byCategory.map(([cat, rows]) => (
            <div key={cat} className="px-2 py-2">
              <div
                className={`mb-1 text-[10px] font-semibold uppercase tracking-wider ${
                  isLf ? "text-[#c8a96e]" : "text-black/45"
                }`}
              >
                {cat}
              </div>
              <ul className="space-y-0.5">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className={`flex justify-between gap-2 text-[11px] tabular-nums ${
                      isLf ? "text-[#1a3a2a]" : "text-black/80"
                    }`}
                  >
                    <span className="min-w-0 truncate">{row.name}</span>
                    <span className="shrink-0 font-mono">${centsToDollars(row.standardPriceCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Minimum standard price in cents from catalog (dry_clean + alteration rows only), or null if unavailable */
export function useCatalogDryCleanMinCents(): number | null {
  const { data } = trpc.catalog.getActiveCatalog.useQuery();
  return useMemo(() => {
    const rows = (data ?? []).filter(isCatalogRowDryCleanOrAlteration);
    if (!rows.length) return null;
    return Math.min(...rows.map((r) => r.standardPriceCents));
  }, [data]);
}
