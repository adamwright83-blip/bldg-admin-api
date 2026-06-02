import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
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

function AdminHostRouter() {
  return (
    <Switch>
      <Route path="/receipt/:orderId" component={DigitalReceiptPage} />
      <Route path="/catalog" component={AdminCatalog} />
      <Route path="/pricing" component={AdminCatalog} />
      <Route path="/admin" component={AdminHostApp} />
      <Route path="/home" component={AdminHostApp} />
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
  const isAdminHost = hostname === "admin.bldg.chat";
  const isDriverHost = hostname === "driver.bldg.chat";
  const isVendorHost = hostname.endsWith(".ops.bldg.chat");
  const vendorSlug = isVendorHost
    ? hostname.replace(".ops.bldg.chat", "")
    : null;

  if (isAdminHost) {
    return <AdminHostRouter />;
  }

  return (
    <Switch>
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
