import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Admin from "./pages/Admin";
import Driver from "./pages/Driver";
import VendorPortal from "./pages/VendorPortal";

function Router() {
  const hostname =
    typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
  const isAdminHost = hostname === "admin.bldg.chat";
  const isDriverHost = hostname === "driver.bldg.chat";
  const isVendorHost = hostname.endsWith(".ops.bldg.chat");
  const vendorSlug = isVendorHost ? hostname.replace(".ops.bldg.chat", "") : null;

  return (
    <Switch>
      <Route
        path={"/"}
        component={
          isAdminHost
            ? Admin
            : isDriverHost
              ? Driver
              : isVendorHost
                ? () => <VendorPortal slug={vendorSlug ?? ""} />
                : Home
        }
      />
      <Route path={"/admin"} component={Admin} />
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
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
