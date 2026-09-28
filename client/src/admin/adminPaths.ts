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

export type LanternScene = "v7" | "v6" | "atlas" | null;
/**
 * Which Lantern City a path shows. V7 is the one Lantern City: the returning-user home and
 * /growth/lantern-city both mount it. The older scenes survive only behind explicit QA
 * parameters (?scene=v6, ?scene=atlas; ?scene=v5 is the atlas's old name). Anywhere else no
 * world is mounted, so the 3D board never runs hidden behind another page.
 */
export function lanternSceneFor(path: string, search: string): LanternScene {
  if (!isAdminCommandCenterPath(path) && path !== "/growth/lantern-city") return null;
  const scene = new URLSearchParams(search).get("scene");
  if (scene === "v6") return "v6";
  if (scene === "atlas" || scene === "v5") return "atlas";
  return "v7";
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
  if (isAdminCommandCenterPath(path) || path === "/demo" || path === "/operator-reflection" || path === "/claire" || path.startsWith("/claire/")) return "home";
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
