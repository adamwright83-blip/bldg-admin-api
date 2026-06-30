import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, Loader2, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { CustomerProfileDrawer } from "@/components/CustomerProfileDrawer";
import { useDebounce } from "@/hooks/useDebounce";
import { trpc } from "@/lib/trpc";
import {
  adminPathToTab,
  isAdminCommandCenterPath,
  type AdminWorkspaceTab,
} from "@/admin/adminPaths";
import AdminHome from "./AdminHome";
import AdminLive from "./AdminLive";
import OperatorReflection from "./OperatorReflection";
import { Level4OffensiveHost } from "@/components/Level4OffensiveHost";
import { AdminCustomerSearchBlock, AdminTabPanels } from "./Admin";
import TruePnlCockpitPage from "./TruePnlCockpitPage";
import { ResidentFollowupAlert } from "@/components/admin/ResidentFollowupAlert";
import RequestJobCardsPage from "./RequestJobCardsPage";
import ProposalReviewPage from "./ProposalReviewPage";
import FirstRealProposalBootstrapPage from "./FirstRealProposalBootstrapPage";
import VendorCastingSprintPage from "./VendorCastingSprintPage";
import MissionControlPage from "./MissionControlPage";
import PostConsentActionPlanPage from "./PostConsentActionPlanPage";

const LIVE_INTERNAL_TABS = new Set<AdminWorkspaceTab>([
  "Intake",
  "Processing",
  "Ready",
  "Pickups",
]);

/**
 * THREE ROOMS AND A DRAWER — the sellable information architecture.
 * Paths are unchanged (deep links + muscle memory survive); the sidebar
 * groups them into rooms, and a room tab strip renders above the page.
 *
 *  KINGDOM  — feel the business, one next action (home).
 *  COUNTER  — where the work gets done (Live is the spine).
 *  PEOPLE   — who we serve, recover, sell to.
 *  DRAWER   — low-frequency configuration only. Money is NOT in here.
 */
/**
 * Two workspaces share the Counter room but are never shown at once.
 * Laundry Butler is the laundry POS workflow; HELD Corporate is the
 * vendor-sourcing/proposal workflow (whose home is Mission Control 2026).
 * The active workspace is derived purely from the current path -- there
 * is no persisted/localStorage state to go stale, so a direct URL load
 * always shows the correct workspace's nav.
 */
type AdminWorkspace = "laundry_butler" | "held_corporate";

const LAUNDRY_BUTLER_TABS: Array<{ label: string; path: string }> = [
  { label: "New order", path: "/new-order" },
  { label: "Intake", path: "/intake" },
  { label: "Cleaning", path: "/processing" },
  { label: "Ready", path: "/ready" },
  { label: "Pickups", path: "/pickups" },
  { label: "Pipeline", path: "/live" },
  { label: "History", path: "/operations-events" },
  { label: "Money owed", path: "/payment-reconciliation" },
];
const HELD_CORPORATE_TABS: Array<{ label: string; path: string }> = [
  { label: "Requests", path: "/requests" },
  { label: "Job cards", path: "/job-cards" },
  { label: "Proposal review", path: "/proposal-review" },
  { label: "Proposal bootstrap", path: "/proposal-bootstrap" },
  { label: "Casting sprint", path: "/casting-sprint" },
  { label: "Mission control", path: "/mission-control" },
  { label: "Post-consent plans", path: "/post-consent-plans" },
];

const HELD_CORPORATE_PATHS = new Set(HELD_CORPORATE_TABS.map((t) => t.path));

/** Counter room = both workspaces' tabs (the union); used only for room detection. */
const COUNTER_PATHS = new Set([
  ...LAUNDRY_BUTLER_TABS.map((t) => t.path),
  ...HELD_CORPORATE_TABS.map((t) => t.path),
]);
const PEOPLE_PATHS = new Set(["/customers", "/leads", "/vendors"]);

const PEOPLE_TABS: Array<{ label: string; path: string }> = [
  { label: "Customers", path: "/customers" },
  { label: "Leads", path: "/leads" },
  { label: "Vendors", path: "/vendors" },
];

/**
 * Route inference wins, always. Any HELD Corporate path => held_corporate;
 * everything else (Laundry Butler Counter paths, People, Drawer pages,
 * unknown) defaults to laundry_butler so the switcher has a stable label.
 */
function workspaceForPath(path: string): AdminWorkspace {
  return HELD_CORPORATE_PATHS.has(path) ? "held_corporate" : "laundry_butler";
}

function normalizePath(loc: string): string {
  const p = loc.split("?")[0]?.replace(/\/$/, "") || "";
  return p === "" ? "/" : p;
}

function parseOrderIdFromLocation(loc: string): number | null {
  const queryString = loc.split("?")[1] ?? "";
  const raw = new URLSearchParams(queryString).get("orderId");
  const orderId = raw ? Number(raw) : NaN;
  return Number.isInteger(orderId) && orderId > 0 ? orderId : null;
}

function parseQuickReceiptFromLocation(loc: string): boolean {
  const queryString = loc.split("?")[1] ?? "";
  const raw = new URLSearchParams(queryString).get("quickReceipt");
  return raw === "1" || raw === "true";
}

function parseOrderIdFromWindowSearch(): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("orderId");
  const orderId = raw ? Number(raw) : NaN;
  return Number.isInteger(orderId) && orderId > 0 ? orderId : null;
}

export default function AdminHostApp() {
  const [loc, navigate] = useLocation();
  const path = normalizePath(loc);
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [profilePhone, setProfilePhone] = useState<string | null>(null);
  const [newOrderPhoneSeed, setNewOrderPhoneSeed] = useState<string | null>(null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const debouncedCustomerQuery = useDebounce(customerSearchQuery, 300);
  const searchOrders = trpc.admin.searchOrdersForReceipt.useQuery(
    { q: debouncedCustomerQuery },
    { enabled: debouncedCustomerQuery.length >= 2 && isAuthenticated }
  );
  const requestsCount = trpc.admin.countNewCoordinatedRequests.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const leadsCount = trpc.admin.countUnreadLeads.useQuery(undefined, { enabled: isAuthenticated });

  useEffect(() => {
    if (path === "/admin") navigate("/new-order", { replace: true });
  }, [path, navigate]);

  const isHome = isAdminCommandCenterPath(path);
  const isOperatorDemo = path === "/demo";
  const isLive = path === "/live";
  const isLevel4 = path === "/level4";
  const isPnl = path === "/pnl";
  const isOperatorReflection = path === "/operator-reflection";
  const activeTab = adminPathToTab(path);
  const isLiveNavActive = isLive || (activeTab !== null && LIVE_INTERNAL_TABS.has(activeTab));
  const isCounter = COUNTER_PATHS.has(path);
  const isPeople = PEOPLE_PATHS.has(path);
  const activeWorkspace = workspaceForPath(path);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Inside the Counter room, show ONLY the active workspace's tabs --
  // never both products at once. People keeps its own tab set.
  const roomTabs = isCounter
    ? activeWorkspace === "held_corporate"
      ? HELD_CORPORATE_TABS
      : LAUNDRY_BUTLER_TABS
    : isPeople
      ? PEOPLE_TABS
      : null;
  const initialSelectedOrderId =
    path === "/intake" ? parseOrderIdFromLocation(loc) ?? parseOrderIdFromWindowSearch() : null;
  const quickReceiptOpen = path === "/intake" && parseQuickReceiptFromLocation(loc);

  useEffect(() => {
    if (path === "/admin") return;
    if (!isHome && !isOperatorDemo && !isLive && !isLevel4 && !isOperatorReflection && activeTab === null) navigate("/", { replace: true });
  }, [isHome, isOperatorDemo, isLive, isLevel4, isOperatorReflection, activeTab, path, navigate]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [path]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8 text-black/30" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm role="admin" onSuccess={() => window.location.reload()} />;
  }

  if (isLevel4) {
    return (
      <div
        className="l4-dedicated min-h-screen w-full bg-[#0e1111] text-[#d1d5db]"
        style={{ fontFamily: '"Inter", system-ui, sans-serif' }}
      >
        <Link
          href="/"
          className="fixed top-3 left-3 z-50 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-white/65 hover:text-white hover:border-white/25 hover:bg-black/60 backdrop-blur-sm transition-colors"
        >
          ← Exit Level 4
        </Link>
        <div className="mx-auto w-full max-w-[1480px] px-3 pt-14 pb-6">
          <Level4OffensiveHost />
        </div>
      </div>
    );
  }

  // The True P&L Cockpit takes over the whole screen — one rail (the cockpit's
  // own), no admin sidebar/header/search chrome. A small patch returns to Board.
  if (isPnl) {
    return (
      <div className="min-h-screen w-full overflow-hidden bg-[#06101d]">
        <Link
          href="/"
          className="fixed top-3 right-3 z-50 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-white/65 backdrop-blur-sm transition-colors hover:border-white/25 hover:bg-black/60 hover:text-white"
        >
          ← Exit Cockpit
        </Link>
        <TruePnlCockpitPage />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-white text-black flex"
      style={{ fontFamily: '"Inter", system-ui, sans-serif' }}
    >
      {/* Drop-everything resident message alarm — flashing red, top of every admin screen. */}
      <ResidentFollowupAlert />
      {mobileNavOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/25 md:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed md:sticky top-0 z-40 h-screen w-56 shrink-0 border-r border-black/10 bg-white flex flex-col py-4 px-2 transition-transform duration-200 md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="px-2 mb-4">
          <span className="text-xs font-semibold tracking-widest uppercase text-black">
            {activeWorkspace === "held_corporate" ? "HELD Corporate" : "Laundry Butler"}
          </span>
        </div>
        {/* THREE ROOMS AND A DRAWER. Every old path still works — the rooms
            are how you move, the tabs (rendered above each room) are how you
            work. Level 4 is reached through the Kingdom (villains/war strip),
            not the nav. The drawer holds configuration only — money lives in
            the Counter where it belongs. */}
        <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
          <Link
            href="/"
            className={`block rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              isHome || isLevel4 ? "bg-black text-white" : "text-black/70 hover:bg-black/5 hover:text-black"
            }`}
            onClick={() => setMobileNavOpen(false)}
          >
            🏰 Kingdom
          </Link>
          <Link
            href="/demo"
            className={`block rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              isOperatorDemo ? "bg-black text-white" : "text-black/70 hover:bg-black/5 hover:text-black"
            }`}
            onClick={() => setMobileNavOpen(false)}
          >
            ✨ Demo Mode
          </Link>
          <Link
            href="/new-order"
            className={`block rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              isCounter ? "bg-black text-white" : "text-black/70 hover:bg-black/5 hover:text-black"
            }`}
            onClick={() => setMobileNavOpen(false)}
          >
            🧺 Counter
            {(requestsCount.data ?? 0) >= 1 ? (
              <span className="ml-1.5 rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-bold text-black/60">
                {requestsCount.data}
              </span>
            ) : null}
          </Link>
          <Link
            href="/customers"
            className={`block rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              isPeople ? "bg-black text-white" : "text-black/70 hover:bg-black/5 hover:text-black"
            }`}
            onClick={() => setMobileNavOpen(false)}
          >
            🫂 People
            {(leadsCount.data ?? 0) >= 1 ? (
              <span className="ml-1.5 rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-bold text-black/60">
                {leadsCount.data}
              </span>
            ) : null}
          </Link>

          <div className="mt-auto flex flex-col gap-2">
            {/* Red diving board — the deliberate, can't-miss jump between
                the two workspaces. Sits above the Drawer. Label + target
                flip based on the path-derived active workspace. */}
            <button
              type="button"
              aria-label={
                activeWorkspace === "held_corporate"
                  ? "Switch to Laundry Butler workspace"
                  : "Switch to HELD Corporate workspace"
              }
              onClick={() => {
                setMobileNavOpen(false);
                navigate(activeWorkspace === "held_corporate" ? "/new-order" : "/mission-control");
              }}
              className="group relative block w-full -skew-x-6 rounded-md bg-red-600 px-3 py-2.5 text-left shadow-[0_4px_0_0_rgb(127_29_29)] outline-none transition-all hover:-translate-y-0.5 hover:bg-red-700 hover:shadow-[0_6px_0_0_rgb(127_29_29)] focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 active:translate-y-0.5 active:shadow-[0_2px_0_0_rgb(127_29_29)]"
            >
              <span className="flex skew-x-6 items-center justify-between gap-2">
                <span className="flex flex-col leading-tight">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-white/75">Switch to</span>
                  <span className="text-sm font-extrabold text-white">
                    {activeWorkspace === "held_corporate" ? "Laundry Butler" : "HELD Corporate"}
                  </span>
                </span>
                <ArrowUpRight className="h-5 w-5 shrink-0 text-white transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </span>
            </button>
          </div>

          <div className="border-t border-black/10 pt-2">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium text-black/55 transition-colors hover:bg-black/5 hover:text-black"
              onClick={() => setDrawerOpen((v) => !v)}
              aria-expanded={drawerOpen}
            >
              ⚙ Drawer
              <span className="text-[10px] text-black/35">{drawerOpen ? "▲" : "▼"}</span>
            </button>
            {drawerOpen ? (
              <div className="mt-0.5 flex flex-col gap-0.5 pl-2">
                <a
                  href="/catalog"
                  className="block rounded-md px-3 py-1.5 text-[13px] text-black/60 hover:bg-black/5 hover:text-black"
                  onClick={() => setMobileNavOpen(false)}
                >
                  Price list
                </a>
                <Link
                  href="/pnl"
                  className="block rounded-md px-3 py-1.5 text-[13px] text-black/60 hover:bg-black/5 hover:text-black"
                  onClick={() => setMobileNavOpen(false)}
                >
                  CFO Cockpit (add-on)
                </Link>
                <Link
                  href="/operator-reflection"
                  className={`block rounded-md px-3 py-1.5 text-[13px] hover:bg-black/5 hover:text-black ${
                    isOperatorReflection ? "text-black font-semibold" : "text-black/60"
                  }`}
                  onClick={() => setMobileNavOpen(false)}
                >
                  Reflection archive
                </Link>
              </div>
            ) : null}
          </div>
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {!isHome && !isOperatorDemo ? (
          <>
            <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-black/10 bg-white px-4 py-2 md:py-3 md:px-6">
              <button
                type="button"
                className="md:hidden rounded-md border border-black/15 p-2 text-black"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
              {/* Room tabs: the views inside a room. Same truth, one room. */}
              {roomTabs ? (
                <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Room views">
                  {roomTabs.map((t) => {
                    const tabActive =
                      path === t.path ||
                      (t.path === "/live" && isLiveNavActive);
                    return (
                      <Link
                        key={t.path}
                        href={t.path}
                        className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                          tabActive
                            ? "bg-black text-white"
                            : "text-black/55 hover:bg-black/5 hover:text-black"
                        }`}
                      >
                        {t.label}
                        {t.path === "/requests" && (requestsCount.data ?? 0) >= 1 ? (
                          <span className={`ml-1 text-[10px] font-bold ${tabActive ? "text-white/70" : "text-black/40"}`}>
                            {requestsCount.data}
                          </span>
                        ) : null}
                      </Link>
                    );
                  })}
                </nav>
              ) : null}
              {/* + Order is the Laundry Butler global action. It is hidden
                  in the HELD Corporate workspace so the misleading laundry
                  CTA is never the primary corporate action (HELD's mission
                  composer lives on the Mission Control page itself). */}
              {activeWorkspace === "held_corporate" ? (
                <span className="ml-auto" />
              ) : (
                <Link
                  href="/new-order"
                  className="ml-auto shrink-0 rounded-md bg-black px-3 py-1.5 text-[12.5px] font-bold text-white transition-colors hover:bg-black/80"
                >
                  + Order
                </Link>
              )}
              <span className="hidden text-xs text-black/40 sm:inline">{user?.name || "Admin"}</span>
            </header>

            {!isLive && !isOperatorReflection ? (
              <AdminCustomerSearchBlock
                customerSearchQuery={customerSearchQuery}
                setCustomerSearchQuery={setCustomerSearchQuery}
                debouncedCustomerQuery={debouncedCustomerQuery}
                searchOrders={searchOrders}
                setProfilePhone={setProfilePhone}
                onPrefillNewOrder={(phone) => {
                  setNewOrderPhoneSeed(phone);
                  navigate("/new-order");
                  setCustomerSearchQuery("");
                }}
              />
            ) : null}
          </>
        ) : null}

        {isHome || isOperatorDemo ? (
          <AdminHome
            experienceMode={isOperatorDemo ? "operator-demo" : "kingdom"}
            operatorName={user?.name || "Admin"}
            onOpenMobileNav={() => setMobileNavOpen(true)}
            onNavigate={(path) => navigate(path)}
            onOpenCustomer={(phone) => setProfilePhone(phone)}
          />
        ) : isLive ? (
          <AdminLive
            onNavigate={(path) => navigate(path)}
            onOpenCustomer={(phone) => setProfilePhone(phone)}
          />
        ) : isOperatorReflection ? (
          <OperatorReflection />
        ) : path === "/job-cards" ? (
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 w-full">
            <RequestJobCardsPage />
          </div>
        ) : path === "/proposal-review" ? (
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 w-full">
            <ProposalReviewPage />
          </div>
        ) : path === "/proposal-bootstrap" ? (
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 w-full">
            <FirstRealProposalBootstrapPage />
          </div>
        ) : path === "/casting-sprint" ? (
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 w-full">
            <VendorCastingSprintPage />
          </div>
        ) : path === "/mission-control" ? (
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 w-full">
            <MissionControlPage />
          </div>
        ) : path === "/post-consent-plans" ? (
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 w-full">
            <PostConsentActionPlanPage />
          </div>
        ) : activeTab ? (
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 w-full">
            <AdminTabPanels
              activeTab={activeTab}
              setProfilePhone={setProfilePhone}
              newOrderPhoneSeed={newOrderPhoneSeed}
              onConsumePhoneSeed={() => setNewOrderPhoneSeed(null)}
              initialSelectedOrderId={initialSelectedOrderId}
              quickReceiptOpen={quickReceiptOpen}
            />
          </div>
        ) : null}

        <CustomerProfileDrawer
          open={profilePhone !== null}
          onOpenChange={(open) => {
            if (!open) setProfilePhone(null);
          }}
          phone={profilePhone}
          onPrefillNewOrder={(p) => {
            setNewOrderPhoneSeed(p);
            navigate("/new-order");
          }}
        />
      </div>
    </div>
  );
}
