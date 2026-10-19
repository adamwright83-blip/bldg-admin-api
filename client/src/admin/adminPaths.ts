export const ADMIN_WORKSPACE_TABS = [
  "New Order",
  "Customers",
  "True P&L Cockpit",
  "Operations Events",
  "Payment Reconciliation",
  "Intake",
  "Processing",
  "Ready",
  "Pickups",
  "Requests",
  "Job Cards",
  "Proposal Review",
  "Proposal Bootstrap",
  "Casting Sprint",
  "Mission Control",
  "Post-Consent Plans",
  "Leads",
  "Vendors",
] as const;

export type AdminWorkspaceTab = (typeof ADMIN_WORKSPACE_TABS)[number];

export const TAB_PATH: Record<AdminWorkspaceTab, string> = {
  "New Order": "/new-order",
  Customers: "/customers",
  "True P&L Cockpit": "/pnl",
  "Operations Events": "/operations-events",
  "Payment Reconciliation": "/payment-reconciliation",
  Intake: "/intake",
  Processing: "/processing",
  Ready: "/ready",
  Pickups: "/pickups",
  Requests: "/requests",
  "Job Cards": "/job-cards",
  "Proposal Review": "/proposal-review",
  "Proposal Bootstrap": "/proposal-bootstrap",
  "Casting Sprint": "/casting-sprint",
  "Mission Control": "/mission-control",
  "Post-Consent Plans": "/post-consent-plans",
  Leads: "/leads",
  Vendors: "/vendors",
};

const PATH_TO_TAB = Object.fromEntries(
  Object.entries(TAB_PATH).map(([tab, path]) => [path, tab])
) as Record<string, AdminWorkspaceTab>;

export function adminPathToTab(path: string): AdminWorkspaceTab | null {
  return PATH_TO_TAB[path] ?? null;
}

export function adminTabToPath(tab: AdminWorkspaceTab): string {
  return TAB_PATH[tab];
}

export function isAdminCommandCenterPath(path: string): boolean {
  return path === "/" || path === "/home" || path.startsWith("/home/");
}

export type LanternScene = "islands" | "map" | "v6" | "atlas" | "silverLake3d" | null;

/**
 * Silver Lake is walkable in 3D (pages/goldline/silverLake3d). The painted V6 encounter is kept dormant:
 * `?walk=0`, `?scene=v6`, or this localStorage key set to "1" still open it.
 */
export const SILVER_LAKE_LEGACY_STORAGE_KEY = "goldline.silverLake.legacy";

export function silverLakeLegacyRequested(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(SILVER_LAKE_LEGACY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
/**
 * Which Lantern City a path shows. The island board is the one Lantern City: the returning-user
 * home and /growth/lantern-city both mount it. The street map (V7) and the older scenes survive
 * only behind explicit QA parameters (?scene=map, or ?scene=v7; ?scene=v6; ?scene=atlas, and
 * ?scene=v5 its old name). Anywhere else no world is mounted, so no 3D scene runs hidden behind
 * another page.
 */
export function lanternSceneFor(path: string, search: string, opts: { legacySilverLake?: boolean } = {}): LanternScene {
  if (!isAdminCommandCenterPath(path) && path !== "/growth/lantern-city") return null;
  const scene = new URLSearchParams(search).get("scene");
  if (scene === "map" || scene === "v7") return "map";
  const params = new URLSearchParams(search);
  if (scene === "v6") return "v6";
  if (params.get("cozy") === "1" || params.get("encounter") === "1") {
    const territory = params.get("territory") ?? "silver-lake";
    const legacy = params.get("walk") === "0" || opts.legacySilverLake === true;
    return territory === "silver-lake" && !legacy && path === "/growth/lantern-city" ? "silverLake3d" : "v6";
  }
  if (scene === "atlas" || scene === "v5") return "atlas";
  return "islands";
}

export type AdminNorthDomain =
  | "home"
  | "operations"
  | "customers"
  | "growth"
  | "money"
  | "settings";

const OPERATIONS_PATHS = new Set([
  "/operations",
  "/live",
  "/new-order",
  "/intake",
  "/processing",
  "/ready",
  "/pickups",
  "/operations-events",
]);

const CUSTOMER_PATHS = new Set(["/customers", "/leads", "/vendors"]);
const MONEY_PATHS = new Set(["/money", "/payment-reconciliation", "/pnl"]);
const SETTINGS_PATHS = new Set(["/settings", "/catalog", "/pricing"]);

export function northDomainForPath(path: string): AdminNorthDomain | null {
  if (isAdminCommandCenterPath(path) || path === "/demo" || path === "/operator-reflection" || path === "/operator" || path === "/claire" || path.startsWith("/claire/")) return "home";
  if (OPERATIONS_PATHS.has(path)) return "operations";
  if (CUSTOMER_PATHS.has(path)) return "customers";
  if (
    path === "/growth" ||
    path.startsWith("/growth/") ||
    path === "/commercial-pipeline" ||
    path === "/churn-radar" ||
    path === "/sales-intel" ||
    path === "/commercial-missions" ||
    path === "/goldline-effectiveness" ||
    path === "/commercial-proposal-settings"
  ) return "growth";
  if (MONEY_PATHS.has(path)) return "money";
  if (SETTINGS_PATHS.has(path)) return "settings";
  return null;
}
