import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Suspense, lazy } from "react";
import { Redirect, Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { TenantProvider, useTenant } from "./hooks/useTenant";
import ButlerHome from "./pages/Home";
import Admin from "./pages/Admin";
import AdminHostApp from "./pages/AdminHostApp";
import Driver from "./pages/Driver";
import VendorPortal from "./pages/VendorPortal";
import DigitalReceiptPage from "./pages/DigitalReceiptPage";
import LaundryFarmHome from "./pages/LaundryFarmHome";
import AdminCatalog from "./pages/AdminCatalog";

// Public product sites are lazy so the operational admin bundle never pays for them.
const BoreslayLanding = lazy(() => import("./pages/BoreslayLanding"));
const DayforgeLanding = lazy(() => import("./pages/DayforgeLanding"));
const LandingFinal = lazy(() => import("./pages/LandingFinal"));
const TerritoryPreview = lazy(() => import("./pages/TerritoryPreview"));
const CommercialMissionAdmin = lazy(
  () => import("./pages/CommercialMissionAdmin")
);
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
const DayforgeOnboardingPage = lazy(
  () => import("./pages/DayforgeOnboardingPage")
);
const DayforgeLoginPage = lazy(() => import("./pages/DayforgeLoginPage"));
const DayforgeTodayPage = lazy(() => import("./pages/DayforgeTodayPage"));
const DayforgeProofPage = lazy(() => import("./pages/DayforgeProofPage"));
const DayforgeSettingsPage = lazy(() => import("./pages/DayforgeSettingsPage"));
const DayforgeInvitePage = lazy(() => import("./pages/DayforgeInvitePage"));
const RallyDemo = lazy(() => import("./components/boreslay-rally/RallyDemo"));
const DayforgeDemoControlPage = lazy(
  () => import("./pages/DayforgeDemoControlPage")
);

function PublicLandingFallback() {
  return <div style={{ minHeight: "100vh", background: "#F6F1E8" }} />;
}

function BoreslayLandingRoute() {
  return (
    <Suspense fallback={<PublicLandingFallback />}>
      <BoreslayLanding />
    </Suspense>
  );
}

function DayforgeLandingRoute() {
  return (
    <Suspense fallback={<PublicLandingFallback />}>
      <DayforgeLanding />
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

const LOCAL_ADMIN_PATHS = new Set([
  "/admin",
  "/home",
  "/demo",
  "/live",
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
]);

function AdminHostRouter() {
  return (
    <Switch>
      {/* Public landing pages are also reachable from the admin host for previewing. */}
      <Route path="/boreslay" component={BoreslayLandingRoute} />
      <Route path="/dayforge" component={DayforgeLandingRoute} />
      <Route path="/landingfinal" component={LandingFinalRoute} />
      <Route path="/territory-preview" component={TerritoryPreviewRoute} />
      <Route path="/dayforge-onboarding">
        <Suspense fallback={<PublicLandingFallback />}>
          <DayforgeOnboardingPage />
        </Suspense>
      </Route>
      <Route path="/dayforge-login">
        <Suspense fallback={<PublicLandingFallback />}>
          <DayforgeLoginPage />
        </Suspense>
      </Route>
      <Route path="/dayforge-today">
        <Suspense fallback={<PublicLandingFallback />}>
          <DayforgeTodayPage />
        </Suspense>
      </Route>
      <Route path="/dayforge-proof"><Suspense fallback={<PublicLandingFallback />}><DayforgeProofPage /></Suspense></Route>
      <Route path="/dayforge-invite">
        <Suspense fallback={<PublicLandingFallback />}>
          <DayforgeInvitePage />
        </Suspense>
      </Route>
      <Route path="/dayforge-settings">
        <Suspense fallback={<PublicLandingFallback />}>
          <DayforgeSettingsPage />
        </Suspense>
      </Route>
      <Route path="/billing">
        <Suspense fallback={<PublicLandingFallback />}>
          <DayforgeSettingsPage />
        </Suspense>
      </Route>
      <Route path="/commercial-missions">
        <Suspense fallback={<PublicLandingFallback />}>
          <CommercialMissionAdmin />
        </Suspense>
      </Route>
      <Route path="/julydemo">
        <Suspense fallback={<PublicLandingFallback />}>
          <DayforgeDemoControlPage />
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
      <Route
        path="/commercial-proposal/:missionId"
        component={CommercialProposalPrintRoute}
      />
      <Route path="/commercial-proposal-settings">
        <Suspense fallback={<PublicLandingFallback />}>
          <CommercialProposalSettings />
        </Suspense>
      </Route>
      <Route path="/churn-radar">
        <Suspense fallback={<PublicLandingFallback />}>
          <ChurnRadarPage />
        </Suspense>
      </Route>
      <Route path="/commercial-pipeline">
        <Suspense fallback={<PublicLandingFallback />}>
          <CommercialPipelinePage />
        </Suspense>
      </Route>
      <Route path="/receipt/:orderId" component={DigitalReceiptPage} />
      <Route path="/catalog" component={AdminCatalog} />
      <Route path="/pricing" component={AdminCatalog} />
      <Route path="/admin" component={AdminHostApp} />
      <Route path="/home" component={AdminHostApp} />
      <Route path="/demo" component={AdminHostApp} />
      <Route path="/live" component={AdminHostApp} />
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
  const isAdminHost = hostname === "admin.bldg.chat";
  const isLocalAdminPath =
    (hostname === "localhost" || hostname === "127.0.0.1") &&
    LOCAL_ADMIN_PATHS.has(window.location.pathname);
  const isDriverHost = hostname === "driver.bldg.chat";
  const isVendorHost = hostname.endsWith(".ops.bldg.chat");
  const vendorSlug = isVendorHost
    ? hostname.replace(".ops.bldg.chat", "")
    : null;

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
      <Route path="/boreslay" component={BoreslayLandingRoute} />
      <Route path="/dayforge" component={DayforgeLandingRoute} />
      <Route path="/landingfinal" component={LandingFinalRoute} />
      <Route path="/territory-preview" component={TerritoryPreviewRoute} />
      <Route path="/dayforge-onboarding">
        <Suspense fallback={<PublicLandingFallback />}>
          <DayforgeOnboardingPage />
        </Suspense>
      </Route>
      <Route path="/dayforge-login">
        <Suspense fallback={<PublicLandingFallback />}>
          <DayforgeLoginPage />
        </Suspense>
      </Route>
      <Route path="/dayforge-invite">
        <Suspense fallback={<PublicLandingFallback />}>
          <DayforgeInvitePage />
        </Suspense>
      </Route>
      <Route path="/dayforge-settings">
        <Suspense fallback={<PublicLandingFallback />}>
          <DayforgeSettingsPage />
        </Suspense>
      </Route>
      <Route path="/billing">
        <Suspense fallback={<PublicLandingFallback />}>
          <DayforgeSettingsPage />
        </Suspense>
      </Route>
      <Route path="/boreslay-rally" component={RallyDemoRoute} />
      <Route
        path="/driver/sales-mission/:missionId"
        component={CommercialSalesMissionRoute}
      />
      <Route
        path="/commercial-proposal/:missionId"
        component={CommercialProposalPrintRoute}
      />
      <Route path="/receipt/:orderId" component={DigitalReceiptPage} />
      <Route path="/catalog" component={AdminCatalog} />
      <Route path="/pricing" component={AdminCatalog} />
      <Route
        path={"/welcome"}
        component={
          tenant.templateType === "laundryfarm" ? LaundryFarmHome : ButlerHome
        }
      />
      <Route
        path={"/"}
        component={
          isDriverHost
            ? Driver
            : isVendorHost
              ? () => <VendorPortal slug={vendorSlug ?? ""} />
              : tenant.templateType === "laundryfarm"
                ? LaundryFarmHome
                : ButlerHome
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
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </TenantProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
