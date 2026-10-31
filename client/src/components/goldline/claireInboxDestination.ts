import {
  isCustomerHostView,
  normalizePath,
  resolveJoystickHostView,
} from "@shared/joystickHostRouting";

/** Inbox destinations that only AdminHostApp serves (Claire call analysis, capability gaps). */
function servedOnlyByAdminHostApp(path: string): boolean {
  return path.startsWith("/claire/") || path.startsWith("/goldline/capability-gaps/");
}

/**
 * Whether the signed-in person can actually open an inbox item's destination
 * on this host, mirroring the host routing in App.tsx and CustomerHostApp.tsx:
 * - platform admins: unchanged (always a link);
 * - app.gojoystick.com refuses every platform path ("customer-forbidden");
 * - the driver host mounts AdminHostApp for /claire and capability-gap paths;
 * - every other host sends a role "user" tenant member to /product for them,
 *   because the SaaS safe-path list admits only the exact /claire Desk.
 * An item whose destination cannot be opened is neither a link nor consumed on view.
 */
export function claireInboxDestinationOpenable(input: {
  href: string;
  hostname: string;
  role: string | null | undefined;
}): boolean {
  if (input.role === "admin") return true;
  const path = normalizePath(input.href);
  const view = resolveJoystickHostView(input.hostname, path);
  if (isCustomerHostView(view)) return view !== "customer-forbidden";
  if (!servedOnlyByAdminHostApp(path)) return true;
  if (view === "driver-shell") return true;
  return input.role !== "user";
}
