import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { centsToDollars } from "@shared/pricing";
import { ChevronDown, ChevronUp } from "lucide-react";

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
  preview = false,
  previewRowsPerCategory = 4,
}: {
  variant?: Variant;
  className?: string;
  /** Scroll area for long menus */
  maxHeightClass?: string;
  /** Butler-only compact mode with optional expand interaction */
  preview?: boolean;
  previewRowsPerCategory?: number;
}) {
  const [expanded, setExpanded] = useState(false);
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

  const isLf = variant === "laundryfarm";
  const showPreview = !isLf && preview;

  const byCategoryDisplay = useMemo(() => {
    if (!showPreview || expanded) return byCategory;
    return byCategory.map(([cat, rows]) => [cat, rows.slice(0, previewRowsPerCategory)] as const);
  }, [byCategory, expanded, previewRowsPerCategory, showPreview]);

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

  const hasOverflow = useMemo(() => {
    if (!showPreview) return false;
    return byCategory.some(([, rows]) => rows.length > previewRowsPerCategory);
  }, [byCategory, previewRowsPerCategory, showPreview]);

  const hiddenCountByCategory = useMemo(() => {
    const map = new Map<string, number>();
    if (!showPreview || expanded) return map;
    for (const [cat, rows] of byCategory) {
      const hiddenCount = Math.max(0, rows.length - previewRowsPerCategory);
      map.set(cat, hiddenCount);
    }
    return map;
  }, [byCategory, expanded, previewRowsPerCategory, showPreview]);

  if (!isLf) {
    return (
      <div className={className}>
        {minFrom != null ? (
          <p className="mb-3 text-[13px] text-[#7e5f6d]">
            Garments from <strong className="text-[#3a1f2b]">${centsToDollars(minFrom)}</strong>.
            {" "}Updated from live catalog pricing.
          </p>
        ) : null}
        <div className="rounded-2xl border border-[#edd8e3] bg-[linear-gradient(170deg,#fffdfc_0%,#fff4f7_100%)] p-3.5 shadow-[0_14px_28px_rgba(158,89,122,0.09)] sm:p-4">
          <div className={`grid gap-3 ${showPreview ? "sm:grid-cols-2" : "sm:grid-cols-2"}`}>
            {byCategoryDisplay.map(([cat, rows]) => {
              const hiddenCount = hiddenCountByCategory.get(cat) ?? 0;
              return (
                <section
                  key={cat}
                  className="rounded-xl border border-[#f1dfe8] bg-white p-3"
                >
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9a6f81]">
                    {cat}
                  </h4>
                  <ul className="space-y-1.5">
                    {rows.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center justify-between gap-2 text-[13px] text-[#4d2d39]"
                      >
                        <span className="min-w-0 truncate">{row.name}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-[#7f2f53]">
                          ${centsToDollars(row.standardPriceCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {hiddenCount > 0 ? (
                    <p className="mt-2 text-[11px] font-medium text-[#99707f]">
                      +{hiddenCount} more in this category
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>
          {showPreview && hasOverflow ? (
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#e5c6d5] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#8a3158] transition-colors hover:bg-[#fff4f9]"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? (
                <>
                  Collapse pricing
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                </>
              ) : (
                <>
                  View full pricing
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                </>
              )}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

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
