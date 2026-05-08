import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { CustomerProfileDrawer } from "@/components/CustomerProfileDrawer";
import { useDebounce } from "@/hooks/useDebounce";
import { trpc } from "@/lib/trpc";
import {
  ADMIN_WORKSPACE_TABS,
  TAB_PATH,
  adminPathToTab,
  isAdminCommandCenterPath,
  type AdminWorkspaceTab,
} from "@/admin/adminPaths";
import AdminHome from "./AdminHome";
import AdminLive from "./AdminLive";
import { Level4OffensiveHost } from "@/components/Level4OffensiveHost";
import { AdminCustomerSearchBlock, AdminTabPanels } from "./Admin";

const LIVE_INTERNAL_TABS = new Set<AdminWorkspaceTab>([
  "Intake",
  "Processing",
  "Ready",
  "Pickups",
]);

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
  const isLive = path === "/live";
  const isLevel4 = path === "/level4";
  const activeTab = adminPathToTab(path);
  const isLiveNavActive = isLive || (activeTab !== null && LIVE_INTERNAL_TABS.has(activeTab));
  const initialSelectedOrderId =
    path === "/intake" ? parseOrderIdFromLocation(loc) ?? parseOrderIdFromWindowSearch() : null;

  useEffect(() => {
    if (path === "/admin") return;
    if (!isHome && !isLive && !isLevel4 && activeTab === null) navigate("/", { replace: true });
  }, [isHome, isLive, isLevel4, activeTab, path, navigate]);

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

  function sidebarLinkClass(hrefPath: string) {
    const active = path === hrefPath;
    return `block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      active ? "bg-black text-white" : "text-black/70 hover:bg-black/5 hover:text-black"
    }`;
  }

  function workspaceTabLabel(tab: AdminWorkspaceTab) {
    const tabActive = path === TAB_PATH[tab];
    const countClass = tabActive ? "text-green-300" : "text-green-600";
    if (tab === "Requests" && (requestsCount.data ?? 0) >= 1) {
      return (
        <>
          Requests <span className={`${countClass} font-semibold`}>({requestsCount.data})</span>
        </>
      );
    }
    if (tab === "Leads" && (leadsCount.data ?? 0) >= 1) {
      return (
        <>
          Leads <span className={`${countClass} font-semibold`}>({leadsCount.data})</span>
        </>
      );
    }
    return tab;
  }

  return (
    <div
      className="min-h-screen bg-white text-black flex"
      style={{ fontFamily: '"Inter", system-ui, sans-serif' }}
    >
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
          <span className="text-xs font-semibold tracking-widest uppercase text-black">Laundry Butler</span>
        </div>
        <nav className="flex flex-col gap-0.5 flex-1 overflow-y-auto">
          <Link
            href="/"
            className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isHome ? "bg-black text-white" : "text-black/70 hover:bg-black/5 hover:text-black"
            }`}
            onClick={() => setMobileNavOpen(false)}
          >
            Board
          </Link>
          <Link
            href="/level4"
            className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isLevel4 ? "bg-black text-white" : "text-black/70 hover:bg-black/5 hover:text-black"
            }`}
            onClick={() => setMobileNavOpen(false)}
          >
            Level 4
          </Link>
          <Link
            href="/live"
            className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isLiveNavActive ? "bg-black text-white" : "text-black/70 hover:bg-black/5 hover:text-black"
            }`}
            onClick={() => setMobileNavOpen(false)}
          >
            Live
          </Link>
          {ADMIN_WORKSPACE_TABS.filter((tab) => !LIVE_INTERNAL_TABS.has(tab)).map((tab) => (
            <Link
              key={tab}
              href={TAB_PATH[tab]}
              className={sidebarLinkClass(TAB_PATH[tab])}
              onClick={() => setMobileNavOpen(false)}
            >
              {workspaceTabLabel(tab)}
            </Link>
          ))}
          <a
            href="/catalog"
            className="block rounded-md px-3 py-2 text-sm font-medium transition-colors text-black/70 hover:bg-black/5 hover:text-black"
            onClick={() => setMobileNavOpen(false)}
          >
            Catalog & Pricing
          </a>
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {!isHome ? (
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
              <span className="text-xs text-black/40 ml-auto">{user?.name || "Admin"}</span>
            </header>

            {!isLive ? (
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

        {isHome ? (
          <AdminHome
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
        ) : activeTab ? (
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 w-full">
            <AdminTabPanels
              activeTab={activeTab}
              setProfilePhone={setProfilePhone}
              newOrderPhoneSeed={newOrderPhoneSeed}
              onConsumePhoneSeed={() => setNewOrderPhoneSeed(null)}
              initialSelectedOrderId={initialSelectedOrderId}
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
