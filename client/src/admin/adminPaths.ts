export const ADMIN_WORKSPACE_TABS = [
  "New Order",
  "Customers",
  "Operations Events",
  "Intake",
  "Processing",
  "Ready",
  "Pickups",
  "Requests",
  "Leads",
  "Vendors",
] as const;

export type AdminWorkspaceTab = (typeof ADMIN_WORKSPACE_TABS)[number];

export const TAB_PATH: Record<AdminWorkspaceTab, string> = {
  "New Order": "/new-order",
  Customers: "/customers",
  "Operations Events": "/operations-events",
  Intake: "/intake",
  Processing: "/processing",
  Ready: "/ready",
  Pickups: "/pickups",
  Requests: "/requests",
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
  return path === "/" || path === "/home";
}
