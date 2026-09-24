/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import GoldlineOnboarding from "./components/goldline/onboarding/GoldlineOnboarding";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import Gumballpals from "@/pages/Gumballpals";
import { Suspense, lazy, type ReactNode } from "react";
import { Redirect, Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { TenantProvider, useTenant } from "./hooks/useTenant";
import { useAuth } from "./_core/hooks/useAuth";
import { LoginForm } from "./components/LoginForm";
import Admin from "./pages/Admin";
import AdminHostApp from "./pages/AdminHostApp";
import Driver from "./pages/Driver";
import VendorPortal from "./pages/VendorPortal";
import DigitalReceiptPage from "./pages/DigitalReceiptPage";
import LaundryFarmHome from "./pages/LaundryFarmHome";
import LaundryButlerWelcome from "./pages/LaundryButlerWelcome";
import LaundryButlerAccount from "./pages/LaundryButlerAccount";
import { GoldlineCelebrationProvider } from "./components/goldline/GoldlineCelebrationProvider";
import { LegacyLandingFrame } from "./product/LegacyProductNotice";

// Public product sites are lazy so the operational admin bundle never pays for them.
const BoreslayLanding = lazy(() => import("./pages/BoreslayLanding"));
const LegacyDayforgeLanding = lazy(() => import("./pages/LegacyDayforgeLanding"));
const LandingFinal = lazy(() => import("./pages/LandingFinal"));
const HeldLanding = lazy(() => import("./pages/HeldLanding"));
const TerritoryPreview = lazy(() => import("./pages/TerritoryPreview"));
const CommercialMissionAdmin = lazy(
  () => import("./pages/CommercialMissionAdmin")
);
const SalesIntelAdmin = lazy(() => import("./pages/SalesIntelAdmin"));
const GoldlineEffectivenessAdmin = lazy(() => import("./pages/GoldlineEffectivenessAdmin"));
const GoldlineCampaignLibraryAdmin = lazy(() => import("./pages/GoldlineCampaignLibraryAdmin"));
const GoldlineKingdomAdmin = lazy(() => import("./pages/GoldlineKingdomAdmin"));
const GoldlineCompanionAdmin = lazy(() => import("./pages/GoldlineCompanionAdmin"));
const GoldlineChapterHost = lazy(() => import("./pages/GoldlineChapterHost"));
const TowerForgeAdmin = lazy(() => import("./pages/TowerForgeAdmin"));
const GuardianRosterPage = lazy(() => import("./pages/GuardianRosterPage"));
const CommercialSalesMission = lazy(
  () => import("./pages/CommercialSalesMission")
);
const CommercialProposalPrint = lazy(
  () => import("./pages/CommercialProposalPrint")
);
const CommercialProposalSettings = lazy(
  () => import("./pages/CommercialProposalSettings")
);
const ChurnRadarPage = lazy(() => import("./pages/ChurnRadarPage"));
const CommercialPipelinePage = lazy(
  () => import("./pages/CommercialPipelinePage")
);
const LegacyDayforgeOnboardingPage = lazy(
  () => import("./pages/LegacyDayforgeOnboardingPage")
);
const LegacyDayforgeLoginPage = lazy(() => import("./pages/LegacyDayforgeLoginPage"));
const LegacyDayforgeTodayPage = lazy(() => import("./pages/LegacyDayforgeTodayPage"));
const LegacyDayforgeProofPage = lazy(() => import("./pages/LegacyDayforgeProofPage"));
const LegacyDayforgeSettingsPage = lazy(() => import("./pages/LegacyDayforgeSettingsPage"));
const StrategyPlaygroundSettingsPage = lazy(() => import("./pages/StrategyPlaygroundSettingsPage"));
const LegacyDayforgeInvitePage = lazy(() => import("./pages/LegacyDayforgeInvitePage"));
const RallyDemo = lazy(() => import("./components/boreslay-rally/RallyDemo"));
const LegacyDayforgeDemoControlPage = lazy(
  () => import("./pages/LegacyDayforgeDemoControlPage")
);
const ProductShell = lazy(() => import("./product/ProductShell"));
// Isolated three.js experiment (Coastal Market Phase 1 proof). Nothing else
// imports this module, so normal Goldline never downloads three.js; it is not
// a corridor, not linked, and carries no business state.
const CoastalMarketProofPage = lazy(
  () => import("./pages/goldline/coastalMarketProof/CoastalMarketProofPage")
);
const COASTAL_MARKET_PROOF_PATH = "/goldline/coastal-market-proof";

function PublicLandingFallback() {
  return <div style={{ minHeight: "100vh", background: "#F6F1E8" }} />;
}

function BoreslayLandingRoute() {
  return (
    <Suspense fallback={<PublicLandingFallback />}>
      <LegacyLandingFrame legacyName="BORESLAY">
        <BoreslayLanding />
      </LegacyLandingFrame>
    </Suspense>
  );
}

function LegacyDayforgeLandingRoute() {
  return (
    <Suspense fallback={<PublicLandingFallback />}>
      <LegacyLandingFrame legacyName="DayForge">
        <LegacyDayforgeLanding />
      </LegacyLandingFrame>
    </Suspense>
  );
}

function LandingFinalRoute() {
  return (
    <Suspense fallback={<PublicLandingFallback />}>
      <LandingFinal />
    </Suspense>
  );
}

function HeldLandingRoute() {
  return (
    <Suspense fallback={<PublicLandingFallback />}>
      <HeldLanding />
    </Suspense>
  );
}

function TerritoryPreviewRoute() {
  return (
    <Suspense fallback={<PublicLandingFallback />}>
      <TerritoryPreview />
    </Suspense>
  );
}

function RallyDemoRoute() {
  return (
    <Suspense
      fallback={<div style={{ minHeight: "100vh", background: "#05060b" }} />}
    >
      <RallyDemo />
    </Suspense>
  );
}

function CommercialSalesMissionRoute() {
  return (
    <Suspense
      fallback={<div style={{ minHeight: "100vh", background: "#08111d" }} />}
    >
      <CommercialSalesMission />
    </Suspense>
  );
}

function CommercialProposalPrintRoute() {
  return (
    <Suspense
      fallback={<div style={{ minHeight: "100vh", background: "#dfe4e9" }} />}
    >
      <CommercialProposalPrint />
    </Suspense>
  );
}

/**
 * Standalone admin-only pages (outside AdminHostApp's own shell) don't get
 * its auth gate for free — without this they render straight through and
 * only fail at the tRPC layer per-query, which is correct server-side but
 * leaves a signed-out visitor staring at a broken page instead of a login
 * prompt.
 */
function signedInWithLegacyDriverPassword(user: {
  openId?: string | null;
  role?: string | null;
} | null): boolean {
  if (!user?.openId || user.role !== "driver") return false;
  return !user.openId.startsWith("dayforge:");
}

function DriverMembershipGate({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  if (authLoading) {
    return <div style={{ minHeight: "100vh", background: "#fff" }} />;
  }
  // A shared-password driver cookie is still signed in, but it is not Claire
  // desk authority. Show the membership form instead of the desk.
  if (!isAuthenticated || signedInWithLegacyDriverPassword(user)) {
    return (
      <LoginForm
        role="driver"
        mode="membership"
        onSuccess={() => window.location.reload()}
      />
    );
  }
  return <>{children}</>;
}

function AdminAuthGate({ children }: { children: ReactNode }) {
  const { loading: authLoading, isAuthenticated } = useAuth();
  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", background: "#fff" }} />
    );
  }
  if (!isAuthenticated) {
    return <LoginForm role="admin" onSuccess={() => window.location.reload()} />;
  }
  return <>{children}</>;
}

const LOCAL_ADMIN_PATHS = new Set([
  "/gumballpals",
  "/admin",
  "/home",
  "/demo",
  "/live",
  "/operations",
  "/growth",
  "/growth/lantern-city",
  "/growth/guardians",
  "/growth/tower-wars",
  "/growth/opus-la-inspection",
  "/growth/sandbox",
  "/growth/driver-intelligence",
  "/growth/driver-intelligence/overlook",
  "/growth/driver-intelligence/archive",
  "/growth/driver-intelligence/beacon",
  "/growth/driver-intelligence/long-table",
  "/growth/driver-intelligence/field-kit",
  "/growth/driver-intelligence/ledger-room",
  "/growth/buildings",
  "/growth/offers",
  "/home/today",
  "/home/exceptions",
  "/home/signals",
  "/home/notes",
  "/money",
  "/settings",
  "/new-order",
  "/customers",
  "/pnl",
  "/operations-events",
  "/payment-reconciliation",
  "/intake",
  "/processing",
  "/ready",
  "/pickups",
  "/requests",
  "/job-cards",
  "/proposal-review",
  "/proposal-bootstrap",
  "/casting-sprint",
  "/mission-control",
  "/post-consent-plans",
  "/leads",
  "/vendors",
  "/level4",
  "/commercial-missions",
  "/tower-forge",
  "/sales-intel",
  "/goldline-campaigns",
  "/goldline-kingdoms",
  "/goldline-companions",
  "/goldline-effectiveness",
  "/goldline-chapter",
  "/commercial-proposal-settings",
  "/churn-radar",
  "/commercial-pipeline",
  "/operator-reflection",
  "/dayforge-demo",
  "/julydemo",
  "/boreslay-rally",
  "/dayforge",
  "/landingfinal",
  "/territory-preview",
  "/dayforge-onboarding",
  "/dayforge-login",
  "/dayforge-today",
  "/dayforge-proof",
  "/dayforge-settings",
  "/dayforge-invite",
  "/billing",
  "/product",
  "/product/field",
  "/product/hq",
  "/product/customers",
  "/product/grow",
  "/product/money",
  "/product/capabilities",
  "/product/hunt",
  "/product/unload",
  "/product/team",
]);

function AdminHostRouter() {
  return (
    <Switch>
      {/* admin.bldg.chat/onboarding is the first-run Goldline onboarding.
          admin.bldg.chat itself stays the returning-customer experience. */}
      <Route path="/onboarding">
        <GoldlineOnboarding entry="onboarding" />
      </Route>
      <Route path="/goldline/start">
        <GoldlineOnboarding />
      </Route>
      <Route path="/gumballpals" component={Gumballpals} />
      <Route path="/product/:rest*">
        <Suspense fallback={<PublicLandingFallback />}>
          <ProductShell />
        </Suspense>
      </Route>
      <Route path="/product">
        <Suspense fallback={<PublicLandingFallback />}>
          <ProductShell />
        </Suspense>
      </Route>
      {/* Public landing pages are also reachable from the admin host for previewing. */}
      <Route path="/boreslay" component={BoreslayLandingRoute} />
      <Route path="/dayforge" component={LegacyDayforgeLandingRoute} />
      <Route path="/landingfinal" component={LandingFinalRoute} />
      <Route path="/territory-preview" component={TerritoryPreviewRoute} />
      <Route path="/dayforge-onboarding">
        <Suspense fallback={<PublicLandingFallback />}>
          <LegacyDayforgeOnboardingPage />
        </Suspense>
      </Route>
      <Route path="/dayforge-login">
        <Suspense fallback={<PublicLandingFallback />}>
          <LegacyDayforgeLoginPage />
        </Suspense>
      </Route>
      <Route path="/dayforge-today">
        <Suspense fallback={<PublicLandingFallback />}>
          <LegacyDayforgeTodayPage />
        </Suspense>
      </Route>
      <Route path="/dayforge-proof">
        <Suspense fallback={<PublicLandingFallback />}>
          <LegacyDayforgeProofPage />
        </Suspense>
      </Route>
      <Route path="/dayforge-invite">
        <Suspense fallback={<PublicLandingFallback />}>
          <LegacyDayforgeInvitePage />
        </Suspense>
      </Route>
      <Route path="/dayforge-settings">
        <Suspense fallback={<PublicLandingFallback />}>
          <LegacyDayforgeSettingsPage />
        </Suspense>
      </Route>
      <Route path="/billing">
        <Suspense fallback={<PublicLandingFallback />}>
          <LegacyDayforgeSettingsPage />
        </Suspense>
      </Route>
      <Route path="/playground-settings">
        <Suspense fallback={<PublicLandingFallback />}>
          <StrategyPlaygroundSettingsPage />
        </Suspense>
      </Route>
      <Route path="/admin/playground">
        <Suspense fallback={<PublicLandingFallback />}>
          <StrategyPlaygroundSettingsPage />
        </Suspense>
      </Route>
      <Route path="/commercial-missions">
        <Suspense fallback={<PublicLandingFallback />}>
          <CommercialMissionAdmin />
        </Suspense>
      </Route>
      <Route path="/tower-forge">
        <AdminAuthGate><Suspense fallback={<PublicLandingFallback />}><TowerForgeAdmin /></Suspense></AdminAuthGate>
      </Route>
      <Route path="/sales-intel" component={AdminHostApp} />
      <Route path="/claire/calls/:sessionId" component={AdminHostApp} />
      <Route path="/goldline/capability-gaps/:gapId" component={AdminHostApp} />
      <Route path="/claire" component={AdminHostApp} />
      <Route path="/goldline-campaigns">
        <AdminAuthGate>
          <Suspense fallback={<PublicLandingFallback />}>
            <GoldlineCampaignLibraryAdmin />
          </Suspense>
        </AdminAuthGate>
      </Route>
      <Route path="/goldline-kingdoms">
        <AdminAuthGate>
          <Suspense fallback={<PublicLandingFallback />}>
            <GoldlineKingdomAdmin />
          </Suspense>
        </AdminAuthGate>
      </Route>
      <Route path="/goldline-companions">
        <AdminAuthGate>
          <Suspense fallback={<PublicLandingFallback />}>
            <GoldlineCompanionAdmin />
          </Suspense>
        </AdminAuthGate>
      </Route>
      <Route path="/goldline-effectiveness">
        <AdminAuthGate>
          <Suspense fallback={<PublicLandingFallback />}>
            <GoldlineEffectivenessAdmin />
          </Suspense>
        </AdminAuthGate>
      </Route>
      {/* Slice 11: internal, unlinked chapter host. Not the final player entry point. */}
      <Route path="/goldline-chapter">
        <AdminAuthGate>
          <Suspense fallback={<PublicLandingFallback />}>
            <GoldlineChapterHost />
          </Suspense>
        </AdminAuthGate>
      </Route>
      <Route path="/julydemo">
        <Suspense fallback={<PublicLandingFallback />}>
          <LegacyDayforgeDemoControlPage />
        </Suspense>
      </Route>
      {/* Kept for backward compatibility with earlier links/bookmarks; /julydemo is canonical. */}
      <Route path="/dayforge-demo">
        <Redirect to="/julydemo" />
      </Route>
      <Route path="/boreslay-rally" component={RallyDemoRoute} />
      <Route
        path="/driver/sales-mission/:missionId"
        component={CommercialSalesMissionRoute}
      />
      <Route path="/driver" component={Driver} />
      <Route
        path="/commercial-proposal/:missionId"
        component={CommercialProposalPrintRoute}
      />
      <Route path="/commercial-proposal-settings">
        <Suspense fallback={<PublicLandingFallback />}>
          <CommercialProposalSettings />
        </Suspense>
      </Route>
      <Route path="/churn-radar" component={AdminHostApp} />
      <Route path="/commercial-pipeline" component={AdminHostApp} />
      <Route path="/receipt/:orderId" component={DigitalReceiptPage} />
      <Route path="/catalog" component={AdminHostApp} />
      <Route path="/pricing" component={AdminHostApp} />
      <Route path="/admin" component={AdminHostApp} />
      <Route path="/home" component={AdminHostApp} />
      <Route path="/demo" component={AdminHostApp} />
      <Route path="/live" component={AdminHostApp} />
      <Route path="/operations" component={AdminHostApp} />
      <Route path="/growth" component={AdminHostApp} />
      <Route path="/growth/lantern-city" component={AdminHostApp} />
      <Route path="/growth/guardians">
        <AdminAuthGate>
          <Suspense fallback={<PublicLandingFallback />}>
            <GuardianRosterPage />
          </Suspense>
        </AdminAuthGate>
      </Route>
      <Route path="/growth/tower-wars" component={AdminHostApp} />
      <Route path="/growth/opus-la-inspection" component={AdminHostApp} />
      <Route path="/growth/sandbox" component={AdminHostApp} />
      <Route path="/growth/driver-intelligence" component={AdminHostApp} />
      <Route path="/growth/driver-intelligence/:rest*" component={AdminHostApp} />
      <Route path="/growth/buildings" component={AdminHostApp} />
      <Route path="/growth/offers" component={AdminHostApp} />
      <Route path="/home/:rest*" component={AdminHostApp} />
      <Route path="/money" component={AdminHostApp} />
      <Route path="/settings" component={AdminHostApp} />
      <Route path="/new-order" component={AdminHostApp} />
      <Route path="/customers" component={AdminHostApp} />
      <Route path="/pnl" component={AdminHostApp} />
      <Route path="/operations-events" component={AdminHostApp} />
      <Route path="/payment-reconciliation" component={AdminHostApp} />
      <Route path="/intake" component={AdminHostApp} />
      <Route path="/processing" component={AdminHostApp} />
      <Route path="/ready" component={AdminHostApp} />
      <Route path="/pickups" component={AdminHostApp} />
      <Route path="/requests" component={AdminHostApp} />
      <Route path="/job-cards" component={AdminHostApp} />
      <Route path="/proposal-review" component={AdminHostApp} />
      <Route path="/proposal-bootstrap" component={AdminHostApp} />
      <Route path="/casting-sprint" component={AdminHostApp} />
      <Route path="/mission-control" component={AdminHostApp} />
      <Route path="/post-consent-plans" component={AdminHostApp} />
      <Route path="/leads" component={AdminHostApp} />
      <Route path="/vendors" component={AdminHostApp} />
      <Route path="/level4" component={AdminHostApp} />
      <Route path="/operator-reflection" component={AdminHostApp} />
      <Route path="/" component={AdminHostApp} />
      <Route component={NotFound} />
    </Switch>
  );
}

function Router() {
  const hostname =
    typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
  const { tenant } = useTenant();
  const isBoreslayHost =
    hostname === "boreslay.com" || hostname === "www.boreslay.com";
  // api.bldg.chat is the real, working backend for this app (Railway); the
  // admin.bldg.chat frontend has historically had no backend wired to it.
  // Both hosts must render the admin shell so DayForge/commercial-mission
  // routes are reachable wherever this app is actually being used.
  const isAdminHost =
    hostname === "admin.bldg.chat" || hostname === "api.bldg.chat";
  const isLocalAdminPath =
    (hostname === "localhost" || hostname === "127.0.0.1") &&
    LOCAL_ADMIN_PATHS.has(window.location.pathname);
  const isDriverHost = hostname === "driver.bldg.chat";
  const isVendorHost = hostname.endsWith(".ops.bldg.chat");
  const vendorSlug = isVendorHost
    ? hostname.replace(".ops.bldg.chat", "")
    : null;

  // The proof route is answered before host routing so no host redirect or
  // auth gate swallows it, and so it never enters the Goldline route graph.
  if (
    !isBoreslayHost &&
    !isVendorHost &&
    window.location.pathname.replace(/\/+$/, "") === COASTAL_MARKET_PROOF_PATH
  ) {
    return (
      <Suspense fallback={<div style={{ minHeight: "100vh", background: "#1b1410" }} />}>
        <CoastalMarketProofPage assetBase="/assets/goldline/coastal-market-three-proof/" />
      </Suspense>
    );
  }

  // driver.bldg.chat has one product URL: the Daily Line. Claire analysis and
  // engineering-request pages are operator follow-through from that line.
  if (isDriverHost) {
    const path = window.location.pathname;
    // Isolated shared-password entrance. Not linked from the membership form.
    if (path === "/legacy-driver-login") {
      return (
        <LoginForm
          role="driver"
          mode="legacy-shared-password"
          onSuccess={() => window.location.assign("/")}
        />
      );
    }
    if (
      path !== "/" &&
      !path.startsWith("/claire") &&
      !path.startsWith("/goldline/capability-gaps")
    ) {
      return <Redirect to="/" />;
    }
    if (path.startsWith("/claire") || path.startsWith("/goldline/capability-gaps")) {
      return (
        <DriverMembershipGate>
          <AdminHostApp />
        </DriverMembershipGate>
      );
    }
  }

  if (isBoreslayHost && window.location.pathname === "/boreslay-rally") {
    return <RallyDemoRoute />;
  }

  if (isBoreslayHost) {
    return <BoreslayLandingRoute />;
  }

  if (isAdminHost || isLocalAdminPath) {
    return <AdminHostRouter />;
  }

  return (
    <Switch>
      <Route path="/onboarding">
        <GoldlineOnboarding entry="onboarding" />
      </Route>
      <Route path="/goldline/start">
        <GoldlineOnboarding />
      </Route>
      <Route path="/product/:rest*">
        <Suspense fallback={<PublicLandingFallback />}>
          <ProductShell />
        </Suspense>
      </Route>
      <Route path="/product">
        <Suspense fallback={<PublicLandingFallback />}>
          <ProductShell />
        </Suspense>
      </Route>
      <Route path="/boreslay" component={BoreslayLandingRoute} />
      <Route path="/dayforge" component={LegacyDayforgeLandingRoute} />
      <Route path="/landingfinal" component={LandingFinalRoute} />
      <Route path="/territory-preview" component={TerritoryPreviewRoute} />
      <Route path="/dayforge-onboarding">
        <Suspense fallback={<PublicLandingFallback />}>
          <LegacyDayforgeOnboardingPage />
        </Suspense>
      </Route>
      <Route path="/dayforge-login">
        <Suspense fallback={<PublicLandingFallback />}>
          <LegacyDayforgeLoginPage />
        </Suspense>
      </Route>
      <Route path="/dayforge-invite">
        <Suspense fallback={<PublicLandingFallback />}>
          <LegacyDayforgeInvitePage />
        </Suspense>
      </Route>
      <Route path="/dayforge-today">
        <Suspense fallback={<PublicLandingFallback />}>
          <LegacyDayforgeTodayPage />
        </Suspense>
      </Route>
      <Route path="/dayforge-settings">
        <Suspense fallback={<PublicLandingFallback />}>
          <LegacyDayforgeSettingsPage />
        </Suspense>
      </Route>
      <Route path="/billing">
        <Suspense fallback={<PublicLandingFallback />}>
          <LegacyDayforgeSettingsPage />
        </Suspense>
      </Route>
      <Route path="/boreslay-rally" component={RallyDemoRoute} />
      <Route
        path="/driver/sales-mission/:missionId"
        component={CommercialSalesMissionRoute}
      />
      <Route path="/driver" component={Driver} />
      <Route path="/payment-reconciliation" component={AdminHostApp} />
      <Route
        path="/commercial-proposal/:missionId"
        component={CommercialProposalPrintRoute}
      />
      <Route path="/receipt/:orderId" component={DigitalReceiptPage} />
      <Route path="/catalog" component={AdminHostApp} />
      <Route path="/pricing" component={AdminHostApp} />
      <Route
        path={"/welcome"}
        component={LaundryButlerWelcome}
      />
      <Route path={"/account"} component={LaundryButlerAccount} />
      <Route
        path={"/"}
        component={
          isDriverHost
            ? Driver
            : isVendorHost
              ? () => <VendorPortal slug={vendorSlug ?? ""} />
              : tenant.templateType === "laundryfarm"
                ? LaundryFarmHome
                : HeldLandingRoute
        }
      />
      <Route path={"/admin"} component={Admin} />
      <Route path={"/pnl"} component={AdminHostApp} />
      <Route path={"/driver"} component={Driver} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TenantProvider>
          <GoldlineCelebrationProvider>
            <TooltipProvider>
              <Toaster />
              <Router />
            </TooltipProvider>
          </GoldlineCelebrationProvider>
        </TenantProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
