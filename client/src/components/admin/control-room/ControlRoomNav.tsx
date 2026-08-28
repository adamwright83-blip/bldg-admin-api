import { Bell, Building2, CalendarDays, ChevronDown, CircleDollarSign, FileText, Home, Map, Menu, Radio, Settings, Sparkles, TrendingUp, Truck, Users } from "lucide-react";
import { Link } from "wouter";
import { northDomainForPath } from "@/admin/adminPaths";

const ASSET_ROOT = "/assets/admin/control-room";

type ControlRoomNavProps = {
  path: string;
  mobileOpen: boolean;
  onNavigate: () => void;
  onOpenMobileNav?: () => void;
  requestCount: number;
  leadCount: number;
  userName?: string;
};

const NORTH_ITEMS = [
  { domain: "home", label: "Home", path: "/", icon: Home },
  { domain: "operations", label: "Operations", path: "/operations", icon: Truck },
  { domain: "customers", label: "Customers", path: "/customers", icon: Users },
  { domain: "growth", label: "Growth", path: "/growth/lantern-city", icon: TrendingUp },
  { domain: "money", label: "Money", path: "/money", icon: CircleDollarSign },
  { domain: "settings", label: "Settings", path: "/settings", icon: Settings },
] as const;

type WestItem = { label: string; path: string; icon: typeof Home; nested?: boolean };

const HOME_WEST: WestItem[] = [
  { label: "Overview", path: "/", icon: Users },
  { label: "Today", path: "/home/today", icon: CalendarDays },
  { label: "Exceptions", path: "/home/exceptions", icon: Bell },
  { label: "Signals", path: "/home/signals", icon: Radio },
  { label: "Notes", path: "/home/notes", icon: FileText },
];
const OPERATIONS_WEST: WestItem[] = [
  { label: "New Order", path: "/new-order", icon: FileText },
  { label: "Intake", path: "/intake", icon: Sparkles },
  { label: "Processing", path: "/processing", icon: Settings },
  { label: "Ready", path: "/ready", icon: Bell },
  { label: "Pickups", path: "/pickups", icon: Truck },
  { label: "Production Board", path: "/operations", icon: Map },
  { label: "History", path: "/operations-events", icon: FileText },
];
const CUSTOMERS_WEST: WestItem[] = [
  { label: "Customers", path: "/customers", icon: Users },
  { label: "Leads", path: "/leads", icon: TrendingUp },
  { label: "Vendors", path: "/vendors", icon: Building2 },
];
const GROWTH_WEST: WestItem[] = [
  { label: "Lantern City", path: "/growth/lantern-city", icon: Map },
  { label: "Tower Wars", path: "/growth/tower-wars", icon: Building2 },
  { label: "Commercial Pipeline", path: "/commercial-pipeline", icon: TrendingUp },
  { label: "Churn / Winback", path: "/churn-radar", icon: Users },
  { label: "Driver Intelligence", path: "/growth/driver-intelligence", icon: Sparkles },
  { label: "Buildings", path: "/growth/buildings", icon: Building2 },
  { label: "Offers", path: "/growth/offers", icon: Bell },
];
const DRIVER_WEST: WestItem[] = [
  { label: "Overlook — Scout", path: "/growth/driver-intelligence/overlook", icon: Map, nested: true },
  { label: "Archive — Intel", path: "/growth/driver-intelligence/archive", icon: FileText, nested: true },
  { label: "Beacon — Follow-Up", path: "/growth/driver-intelligence/beacon", icon: Radio, nested: true },
  { label: "Long Table — Relationship", path: "/growth/driver-intelligence/long-table", icon: Users, nested: true },
  { label: "Armory — Sales Intelligence", path: "/sales-intel", icon: TrendingUp, nested: true },
  { label: "Field Kit — Supply Room", path: "/growth/driver-intelligence/field-kit", icon: Truck, nested: true },
  { label: "Ledger Room — Action Detail", path: "/growth/driver-intelligence/ledger-room", icon: FileText, nested: true },
];
const MONEY_WEST: WestItem[] = [
  { label: "Overview", path: "/money", icon: CircleDollarSign },
  { label: "Reconciliation", path: "/payment-reconciliation", icon: FileText },
  { label: "True P&L", path: "/pnl", icon: TrendingUp },
];
const SETTINGS_WEST: WestItem[] = [
  { label: "Overview", path: "/settings", icon: Settings },
  { label: "Catalog & Pricing", path: "/catalog", icon: FileText },
];

const HELD_PATHS = new Set(["/requests", "/job-cards", "/proposal-review", "/proposal-bootstrap", "/casting-sprint", "/mission-control", "/post-consent-plans"]);
const HELD_WEST: WestItem[] = [
  { label: "Requests", path: "/requests", icon: Bell },
  { label: "Job Cards", path: "/job-cards", icon: FileText },
  { label: "Proposal Review", path: "/proposal-review", icon: FileText },
  { label: "Proposal Bootstrap", path: "/proposal-bootstrap", icon: Sparkles },
  { label: "Casting Sprint", path: "/casting-sprint", icon: Users },
  { label: "Mission Control", path: "/mission-control", icon: Map },
  { label: "Post-Consent Plans", path: "/post-consent-plans", icon: TrendingUp },
];

function westItemsForPath(path: string): { label: string; items: WestItem[] } {
  if (HELD_PATHS.has(path)) return { label: "HELD Corporate", items: HELD_WEST };
  const domain = northDomainForPath(path);
  if (domain === "operations") return { label: "Operations", items: OPERATIONS_WEST };
  if (domain === "customers") return { label: "Customers", items: CUSTOMERS_WEST };
  if (domain === "growth") {
    if (path.startsWith("/growth/driver-intelligence") || path === "/sales-intel") return { label: "Growth", items: [...GROWTH_WEST, ...DRIVER_WEST] };
    return { label: "Growth", items: GROWTH_WEST };
  }
  if (domain === "money") return { label: "Money", items: MONEY_WEST };
  if (domain === "settings") return { label: "Settings", items: SETTINGS_WEST };
  return { label: "Home", items: HOME_WEST };
}

function isWestActive(path: string, itemPath: string) {
  if (itemPath === "/" && (path === "/" || path === "/home")) return true;
  if (itemPath === "/operations" && path === "/live") return true;
  if (itemPath === "/catalog" && path === "/pricing") return true;
  return path === itemPath;
}

export function ControlRoomNav({ path, mobileOpen, onNavigate, onOpenMobileNav, requestCount, leadCount, userName = "Admin" }: ControlRoomNavProps) {
  const activeDomain = northDomainForPath(path);
  const west = westItemsForPath(path);
  const initials = userName.split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join("").toUpperCase() || "A";
  return (
    <>
      <header className="cr-north-nav">
        <button type="button" className="cr-north-menu" onClick={onOpenMobileNav} aria-label="Open navigation"><Menu /></button>
        <Link href="/" className="cr-brand" onClick={onNavigate} aria-label="Tower Wars Admin home">
          <img src={`${ASSET_ROOT}/brand/goldline-admin-crest.svg`} alt="" /><strong>Tower<br />Wars</strong>
        </Link>
        <nav aria-label="Admin business domains">
          {NORTH_ITEMS.map(item => {
            const Icon = item.icon;
            const active = activeDomain === item.domain;
            const badge = item.domain === "operations" ? requestCount : item.domain === "customers" ? leadCount : 0;
            return <Link key={item.domain} href={item.path} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined} onClick={onNavigate}><Icon aria-hidden /><span>{item.label}</span>{badge > 0 ? <b>{badge}</b> : null}</Link>;
          })}
        </nav>
        <div className="cr-admin-identity" aria-label={`Signed in as ${userName}`}><Bell aria-hidden /><span className="cr-avatar">{initials}</span><span><strong>{userName}</strong><small>Admin</small></span><ChevronDown aria-hidden /></div>
      </header>
      {mobileOpen ? <button type="button" className="cr-mobile-scrim" aria-label="Close navigation" onClick={onNavigate} /> : null}
      <aside className={`cr-west-nav ${mobileOpen ? "is-open" : ""}`}>
        <div className="cr-west-brand-mobile"><img src={`${ASSET_ROOT}/brand/goldline-admin-crest.svg`} alt="" /><strong>Tower Wars</strong></div>
        <span className="cr-west-label">{west.label}</span>
        <nav aria-label={`${west.label} views`}>
          {west.items.map(item => { const Icon = item.icon; const active = isWestActive(path, item.path); return <Link key={item.path} href={item.path} className={`${active ? "is-active" : ""} ${item.nested ? "is-nested" : ""}`} aria-current={active ? "page" : undefined} onClick={onNavigate}><Icon aria-hidden /><span>{item.label}</span></Link>; })}
        </nav>
        <div className="cr-season-card" aria-label="Competition season not configured"><span className="cr-season-trophy">★</span><div><strong>Competition</strong><small>Season not configured</small></div><span>No leaderboard available</span></div>
      </aside>
    </>
  );
}
