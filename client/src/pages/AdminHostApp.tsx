import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
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
import AdminCatalog from "./AdminCatalog";
import OperatorReflection from "./OperatorReflection";
import { AdminCustomerSearchBlock, AdminTabPanels } from "./Admin";
import TruePnlCockpitPage from "./TruePnlCockpitPage";
import { ResidentFollowupAlert } from "@/components/admin/ResidentFollowupAlert";
import RequestJobCardsPage from "./RequestJobCardsPage";
import ProposalReviewPage from "./ProposalReviewPage";
import FirstRealProposalBootstrapPage from "./FirstRealProposalBootstrapPage";
import VendorCastingSprintPage from "./VendorCastingSprintPage";
import MissionControlPage from "./MissionControlPage";
import PostConsentActionPlanPage from "./PostConsentActionPlanPage";
import { ControlRoomNav } from "@/components/admin/control-room/ControlRoomNav";
import {
  GrowthBuildingsPage,
  GrowthOffersPage,
  MoneyControlRoom,
  SettingsControlRoom,
} from "@/components/admin/control-room/ControlRoomSections";
import LanternCityAtlas from "@/components/admin/control-room/LanternCityAtlas";
import DriverIntelligenceOverview from "@/components/admin/control-room/DriverIntelligenceOverview";
import { TowerWars } from "@/components/admin/control-room/TowerWars";
import "@/components/admin/control-room/admin-control-room.css";
import { WorldTransitionProvider } from "@/components/admin/control-room/WorldTransitionProvider";
import { WorldDayPhaseIndicator } from "@/components/admin/control-room/WorldDayPhase";

const ArchivedLevel4OffensiveHost = lazy(() =>
  import("@/components/Level4OffensiveHost").then(module => ({
    default: module.Level4OffensiveHost,
  }))
);
const CommercialPipelinePage = lazy(() => import("./CommercialPipelinePage"));
const ChurnRadarPage = lazy(() => import("./ChurnRadarPage"));
const SalesIntelAdmin = lazy(() => import("./SalesIntelAdmin"));

const LIVE_INTERNAL_TABS = new Set<AdminWorkspaceTab>([
  "Intake",
  "Processing",
  "Ready",
  "Pickups",
]);

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
  { label: "Production board", path: "/operations" },
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

const HELD_CORPORATE_PATHS = new Set(HELD_CORPORATE_TABS.map(t => t.path));

/** Counter room = both workspaces' tabs (the union); used only for room detection. */
const COUNTER_PATHS = new Set([
  ...LAUNDRY_BUTLER_TABS.map(t => t.path),
  ...HELD_CORPORATE_TABS.map(t => t.path),
  "/live",
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
  const [newOrderPhoneSeed, setNewOrderPhoneSeed] = useState<string | null>(
    null
  );
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const debouncedCustomerQuery = useDebounce(customerSearchQuery, 300);
  const searchOrders = trpc.admin.searchOrdersForReceipt.useQuery(
    { q: debouncedCustomerQuery },
    { enabled: debouncedCustomerQuery.length >= 2 && isAuthenticated }
  );
  const requestsCount = trpc.admin.countNewCoordinatedRequests.useQuery(
    undefined,
    {
      enabled: isAuthenticated,
    }
  );
  const leadsCount = trpc.admin.countUnreadLeads.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (path === "/admin") navigate("/", { replace: true });
  }, [path, navigate]);

  const isHome = isAdminCommandCenterPath(path);
  const isOperatorDemo = path === "/demo";
  const isLive = path === "/live" || path === "/operations";
  const isLevel4 = path === "/level4";
  const isPnl = path === "/pnl";
  const isOperatorReflection = path === "/operator-reflection";
  const isGrowth = path === "/growth";
  const isLanternCity = path === "/growth/lantern-city";
  const isTowerWars = path === "/growth/tower-wars";
  const isDriverIntelligence = path.startsWith("/growth/driver-intelligence");
  const isGrowthBuildings = path === "/growth/buildings";
  const isGrowthOffers = path === "/growth/offers";
  const isCommercialPipeline = path === "/commercial-pipeline";
  const isChurnRadar = path === "/churn-radar";
  const isSalesIntel = path === "/sales-intel";
  const isMoney = path === "/money";
  const isSettings = path === "/settings";
  const isCatalog = path === "/catalog" || path === "/pricing";
  const isControlRoomSection =
    isGrowth ||
    isLanternCity ||
    isTowerWars ||
    isDriverIntelligence ||
    isGrowthBuildings ||
    isGrowthOffers ||
    isCommercialPipeline ||
    isChurnRadar ||
    isSalesIntel ||
    isMoney ||
    isSettings ||
    isCatalog;
  const activeTab = adminPathToTab(path);
  const isLiveNavActive =
    isLive || (activeTab !== null && LIVE_INTERNAL_TABS.has(activeTab));
  const isCounter = COUNTER_PATHS.has(path);
  const isPeople = PEOPLE_PATHS.has(path);
  const activeWorkspace = workspaceForPath(path);
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
    path === "/intake"
      ? (parseOrderIdFromLocation(loc) ?? parseOrderIdFromWindowSearch())
      : null;
  const quickReceiptOpen =
    path === "/intake" && parseQuickReceiptFromLocation(loc);

  useEffect(() => {
    if (path === "/growth") {
      navigate("/growth/lantern-city", { replace: true });
      return;
    }
    if (path === "/admin") return;
    if (
      !isHome &&
      !isOperatorDemo &&
      !isLive &&
      !isLevel4 &&
      !isOperatorReflection &&
      !isControlRoomSection &&
      activeTab === null
    )
      navigate("/", { replace: true });
  }, [
    isHome,
    isOperatorDemo,
    isLive,
    isLevel4,
    isOperatorReflection,
    isControlRoomSection,
    activeTab,
    path,
    navigate,
  ]);

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
    return (
      <LoginForm role="admin" onSuccess={() => window.location.reload()} />
    );
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
          <Suspense
            fallback={
              <div className="py-20 text-center text-white/50">
                Loading archived Level 4 experience…
              </div>
            }
          >
            <ArchivedLevel4OffensiveHost />
          </Suspense>
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
    <WorldTransitionProvider>
    <div className="cr-shell">
      {isCounter && activeWorkspace !== "held_corporate" ? (
        <ResidentFollowupAlert />
      ) : null}

      <ControlRoomNav
        path={path}
        mobileOpen={mobileNavOpen}
        onNavigate={() => setMobileNavOpen(false)}
        requestCount={requestsCount.data ?? 0}
        leadCount={leadsCount.data ?? 0}
        userName={user?.name || "Admin"}
        onOpenMobileNav={() => setMobileNavOpen(true)}
      />

      <div className="cr-main-column">
        {isControlRoomSection || isHome ? <WorldDayPhaseIndicator /> : null}
        {!isHome &&
        !isOperatorDemo &&
        !isLive &&
        !isOperatorReflection &&
        !isControlRoomSection ? (
          <AdminCustomerSearchBlock
            customerSearchQuery={customerSearchQuery}
            setCustomerSearchQuery={setCustomerSearchQuery}
            debouncedCustomerQuery={debouncedCustomerQuery}
            searchOrders={searchOrders}
            setProfilePhone={setProfilePhone}
            onPrefillNewOrder={phone => {
              setNewOrderPhoneSeed(phone);
              navigate("/new-order");
              setCustomerSearchQuery("");
            }}
          />
        ) : null}

        {isHome || isOperatorDemo ? (
          <AdminHome
            experienceMode={isOperatorDemo ? "operator-demo" : "kingdom"}
            operatorName={user?.name || "Admin"}
            path={path}
            onOpenMobileNav={() => setMobileNavOpen(true)}
            onNavigate={path => navigate(path)}
            onOpenCustomer={phone => setProfilePhone(phone)}
          />
        ) : isLive ? (
          <AdminLive
            onNavigate={path => navigate(path)}
            onOpenCustomer={phone => setProfilePhone(phone)}
          />
        ) : isLanternCity ? (
          <LanternCityAtlas onOpenCustomer={phone => setProfilePhone(phone)} />
        ) : isTowerWars ? (
          <TowerWars onNavigate={nextPath => navigate(nextPath)} />
        ) : isDriverIntelligence ? (
          <DriverIntelligenceOverview path={path} />
        ) : isGrowthBuildings ? (
          <GrowthBuildingsPage />
        ) : isGrowthOffers ? (
          <GrowthOffersPage />
        ) : isCommercialPipeline ? (
          <Suspense
            fallback={
              <div className="cr-route-loading">
                Loading Commercial Pipeline…
              </div>
            }
          >
            <CommercialPipelinePage />
          </Suspense>
        ) : isChurnRadar ? (
          <Suspense
            fallback={
              <div className="cr-route-loading">Loading Churn / Winback…</div>
            }
          >
            <ChurnRadarPage />
          </Suspense>
        ) : isSalesIntel ? (
          <Suspense
            fallback={
              <div className="cr-route-loading">
                Loading Sales Intelligence…
              </div>
            }
          >
            <SalesIntelAdmin />
          </Suspense>
        ) : isMoney ? (
          <MoneyControlRoom />
        ) : isSettings ? (
          <SettingsControlRoom />
        ) : isCatalog ? (
          <AdminCatalog />
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
          onOpenChange={open => {
            if (!open) setProfilePhone(null);
          }}
          phone={profilePhone}
          onPrefillNewOrder={p => {
            setNewOrderPhoneSeed(p);
            navigate("/new-order");
          }}
        />
      </div>
    </div>
    </WorldTransitionProvider>
  );
}
