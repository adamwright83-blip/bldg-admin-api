/* LEGACY DAYFORGE COMPATIBILITY: retained historical route literals only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { trpc } from "@/lib/trpc";
import {
  isPlatformAdminPath,
  normalizePath,
  resolveJoystickHostView,
  type JoystickHostView,
} from "@shared/joystickHostRouting";

const ProductShell = lazy(() => import("@/product/ProductShell"));
const Driver = lazy(() => import("@/pages/Driver"));
const GoldlineOnboarding = lazy(() => import("@/components/goldline/onboarding/GoldlineOnboarding"));
const JoystickAcquisitionPage = lazy(() => import("@/pages/JoystickAcquisitionPage"));
const ClaireDesk = lazy(() => import("@/pages/goldline/ClaireDesk"));
const JoystickWorld = lazy(() => import("@/product/JoystickWorld"));
const GoldlineChapterHost = lazy(() => import("@/pages/GoldlineChapterHost"));
const OperatorRepresentativePage = lazy(() => import("@/pages/operator/OperatorRepresentative"));
const LegacyDayforgeSettingsPage = lazy(() => import("@/pages/LegacyDayforgeSettingsPage"));
const LegacyDayforgeInvitePage = lazy(() => import("@/pages/LegacyDayforgeInvitePage"));
const LegacyDayforgeOnboardingPage = lazy(() => import("@/pages/LegacyDayforgeOnboardingPage"));
const DigitalReceiptPage = lazy(() => import("@/pages/DigitalReceiptPage"));

function CustomerFallback() {
  return <div style={{ minHeight: "100vh", background: "#fff" }} />;
}

function CustomerLogin() {
  return (
    <LoginForm
      role="driver"
      mode="membership"
      onSuccess={() => window.location.assign("/product")}
    />
  );
}

function CustomerRefusal() {
  return (
    <main data-joystick-host="app.gojoystick.com" data-joystick-forbidden="platform-admin">
      <h1>Customer app</h1>
      <p>This host does not serve the control room.</p>
    </main>
  );
}

function signedInWithLegacyDriverPassword(user: {
  openId?: string | null;
  role?: string | null;
} | null): boolean {
  if (!user?.openId || user.role !== "driver") return false;
  return !user.openId.startsWith("dayforge:");
}

function CustomerMembershipGate({ children }: { children: ReactNode }) {
  const { user, loading, isAuthenticated } = useAuth();
  if (loading) return <CustomerFallback />;
  if (!isAuthenticated || signedInWithLegacyDriverPassword(user)) return <CustomerLogin />;
  return <>{children}</>;
}

function CustomerOperatorGate({ children }: { children: ReactNode }) {
  const { loading, isAuthenticated } = useAuth();
  const me = trpc.system.saas.me.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: false,
  });
  const destination = !isAuthenticated
    ? null
    : me.data?.membership.role === "field"
      ? "/play"
      : me.isError
        ? "/product"
        : null;
  useEffect(() => {
    if (destination) window.location.replace(destination);
  }, [destination]);
  if (loading || (isAuthenticated && me.isLoading)) return <CustomerFallback />;
  if (!isAuthenticated) return <CustomerLogin />;
  if (destination) return <CustomerFallback />;
  return <>{children}</>;
}

function renderCustomerView(view: JoystickHostView, path: string) {
  if (view === "customer-forbidden") return <CustomerRefusal />;
  if (view === "customer-root") return <CustomerLogin />;
  if (view === "customer-play") {
    return (
      <CustomerMembershipGate>
        <Suspense fallback={<CustomerFallback />}>
          <Driver />
        </Suspense>
      </CustomerMembershipGate>
    );
  }
  if (view === "customer-onboarding") {
    return (
      <Suspense fallback={<CustomerFallback />}>
        <GoldlineOnboarding entry={path === "/onboarding" ? "onboarding" : undefined} />
      </Suspense>
    );
  }
  if (view === "customer-acquisition") {
    return (
      <Suspense fallback={<CustomerFallback />}>
        <JoystickAcquisitionPage />
      </Suspense>
    );
  }
  if (view === "customer-claire") {
    return (
      <CustomerOperatorGate>
        <Suspense fallback={<CustomerFallback />}>
          <ClaireDesk />
        </Suspense>
      </CustomerOperatorGate>
    );
  }
  if (view === "customer-lantern") {
    return (
      <CustomerOperatorGate>
        <Suspense fallback={<CustomerFallback />}>
          <JoystickWorld />
        </Suspense>
      </CustomerOperatorGate>
    );
  }
  if (view === "customer-chapter") {
    return (
      <CustomerOperatorGate>
        <Suspense fallback={<CustomerFallback />}>
          <GoldlineChapterHost />
        </Suspense>
      </CustomerOperatorGate>
    );
  }
  if (view === "customer-operator") {
    return (
      <CustomerOperatorGate>
        <Suspense fallback={<CustomerFallback />}>
          <OperatorRepresentativePage />
        </Suspense>
      </CustomerOperatorGate>
    );
  }
  if (view === "customer-settings") {
    return (
      <CustomerMembershipGate>
        <Suspense fallback={<CustomerFallback />}>
          <LegacyDayforgeSettingsPage />
        </Suspense>
      </CustomerMembershipGate>
    );
  }
  if (view === "customer-invite") {
    return (
      <Suspense fallback={<CustomerFallback />}>
        <LegacyDayforgeInvitePage />
      </Suspense>
    );
  }
  if (view === "customer-legacy-onboarding") {
    return (
      <Suspense fallback={<CustomerFallback />}>
        <LegacyDayforgeOnboardingPage />
      </Suspense>
    );
  }
  if (view === "customer-product" && path.startsWith("/receipt/")) {
    return (
      <Suspense fallback={<CustomerFallback />}>
        <DigitalReceiptPage />
      </Suspense>
    );
  }
  return (
    <CustomerMembershipGate>
      <Suspense fallback={<CustomerFallback />}>
        <ProductShell />
      </Suspense>
    </CustomerMembershipGate>
  );
}

/**
 * app.gojoystick.com is the authenticated customer and player app.
 * It never mounts the platform admin shell or the shared admin password form.
 */
export function CustomerHostApp() {
  const { user, loading } = useAuth();
  const path = typeof window !== "undefined" ? normalizePath(window.location.pathname) : "/";
  const hostname = typeof window !== "undefined" ? window.location.hostname : "";
  const view = resolveJoystickHostView(hostname, path);

  const openProduct = view === "customer-root" && Boolean(user) && user?.role !== "admin";
  useEffect(() => {
    if (openProduct) window.location.replace("/product");
  }, [openProduct]);
  if (loading) return <CustomerFallback />;
  if (user?.role === "admin" || isPlatformAdminPath(path) || view === "customer-forbidden") {
    return <CustomerRefusal />;
  }
  if (openProduct) return <CustomerFallback />;
  return renderCustomerView(view, path);
}
