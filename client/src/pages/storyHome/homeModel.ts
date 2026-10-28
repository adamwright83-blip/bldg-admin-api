import type { AccountSnapshotMetric } from "@shared/accountSnapshot";
import type { LanternTerritoryReport } from "@shared/lanternTerritoryReport";
import type { StoryResolvedLine, StoryTonight } from "@shared/story";
import { silverLake3DHref } from "@/pages/goldline/silverLake3d/silverLakeEntry";
import { beverlyHills3DHref } from "@/pages/goldline/beverlyHills3d/beverlyHillsEntry";

/** Pure view helpers for the main account page. No network, no story words. */

export const NOT_WIRED = "Not wired yet";

/** Top-bar icons. Each is an existing route; an icon without a real destination is left out. */
export const HOME_NAV = [
  { key: "city", label: "Lantern City", path: "/growth/lantern-city" },
  { key: "customers", label: "Customers", path: "/customers" },
  { key: "operations", label: "Operations", path: "/operations" },
  { key: "money", label: "Money", path: "/money" },
  { key: "settings", label: "Settings", path: "/settings" },
] as const;

/** Fixed art paths. Final art lands at these paths in its own commit; until then the page falls back. */
export const HOME_ART = {

  claire: "/assets/goldline/home/claire-masked.png",
  neighbourhood: (slug: string) => `/assets/goldline/home/neighbourhoods/${slug}.webp`,
  neighbourhoodFallback: (slug: string) => `/assets/admin/control-room/world/territories-v2/${slug}.webp`,
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const count = new Intl.NumberFormat("en-US");

export type MetricView = {
  text: string;
  wired: boolean;
  /** The ledger holds this much; coverage does not license it as exact. */
  recorded: boolean;
  change: { text: string; direction: "up" | "down" | "flat" } | null;
};

export function metricView(metric: AccountSnapshotMetric | null | undefined, kind: "cents" | "count"): MetricView {
  if (!metric || metric.value == null) return { text: NOT_WIRED, wired: false, recorded: false, change: null };
  const text = kind === "cents" ? usd.format(metric.value / 100) : count.format(metric.value);
  const pct = metric.changePct;
  const change =
    pct == null
      ? null
      : {
          text: `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(Math.abs(pct) >= 100 ? 0 : 1).replace(/\.0$/, "")}%`,
          direction: pct > 0 ? ("up" as const) : pct < 0 ? ("down" as const) : ("flat" as const),
        };
  return { text, wired: true, recorded: metric.precision === "recorded", change };
}

export function moneyOrNotWired(cents: number | null | undefined): string {
  return cents == null ? NOT_WIRED : usd.format(cents / 100);
}

/** The arrow on a neighbourhood card: its game or tower view where one exists, otherwise the island board. */
export function neighbourhoodHref(territoryId: string): string {
  switch (territoryId) {
    case "silver-lake":
      return silverLake3DHref("silver-lake");
    case "beverly-hills":
      return beverlyHills3DHref();
    case "century-city":
      return "/growth/lantern-city?level=century-park-east";
    default:
      return "/growth/lantern-city";
  }
}

export type NeighbourhoodCard = {
  id: string;
  name: string;
  revenueText: string;
  customers: number;
  href: string;
};

/**
 * The operator's real neighbourhoods: the territories in their service area where they have located customers or
 * recorded revenue. Biggest first. Revenue the report withholds reads "Not wired yet", never $0.
 */
export function neighbourhoodCards(report: LanternTerritoryReport | null | undefined): NeighbourhoodCard[] {
  if (!report || report.status === "unsupported_geography") return [];
  return report.territories
    .filter(territory => territory.locatedCustomers > 0 || (territory.revenueCents ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.revenueCents ?? -1) - (a.revenueCents ?? -1) ||
        b.locatedCustomers - a.locatedCustomers ||
        a.name.localeCompare(b.name)
    )
    .map(territory => ({
      id: territory.id,
      name: territory.name,
      revenueText: moneyOrNotWired(territory.revenueCents),
      customers: territory.locatedCustomers,
      href: neighbourhoodHref(territory.id),
    }));
}

export type StoryEnabled = Extract<StoryTonight, { enabled: true }>;

/** "CHAPTER 01". */
export function chapterEyebrow(number: number): string {
  return `CHAPTER ${String(number).padStart(2, "0")}`;
}

/**
 * Splits tonight's before-lines into the hook under the title and Claire's handwritten note. With two or more
 * lines, the last is Claire's note; with one, it is the hook and there is no note. Every word comes from the server.
 */
export function heroLines(before: readonly StoryResolvedLine[]): { hook: StoryResolvedLine[]; note: StoryResolvedLine | null } {
  if (before.length < 2) return { hook: [...before], note: null };
  return { hook: before.slice(0, -1), note: before[before.length - 1]! };
}


const INTRO_KEY = "joystick.home.intro.v1";

/** YYYY-MM-DD in the viewer's own time zone. */
export function localDay(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Whether tonight's open plays the opening sequence: the first open of each day, never with reduced motion.
 * `?intro=1` forces it (demos, checks). Storage is a per-browser convenience; if it is unavailable the intro plays.
 */
export function claimDailyIntro(
  env: { now?: Date; reducedMotion?: boolean; search?: string; storage?: Pick<Storage, "getItem" | "setItem"> | null } = {}
): boolean {
  const search = env.search ?? (typeof window !== "undefined" ? window.location.search : "");
  if (new URLSearchParams(search).get("intro") === "1") return true;
  const reduced =
    env.reducedMotion ??
    (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (reduced) return false;
  const today = localDay(env.now ?? new Date());
  let storage = env.storage;
  if (storage === undefined) {
    try {
      storage = typeof window !== "undefined" ? window.localStorage : null;
    } catch {
      storage = null;
    }
  }
  try {
    if (storage?.getItem(INTRO_KEY) === today) return false;
    storage?.setItem(INTRO_KEY, today);
  } catch {
    /* no storage: play it */
  }
  return true;
}
