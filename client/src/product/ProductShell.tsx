/* LEGACY DAYFORGE COMPATIBILITY: retained historical route only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { trpc } from "@/lib/trpc";
import { PRODUCT_NAME } from "@shared/productIdentity";
import FieldHome from "./FieldHome";
import HqHome from "./HqHome";
import UnloadView from "./UnloadView";
import HuntView from "./HuntView";
import "./product.css";

export default function ProductShell() {
  const { loading, isAuthenticated } = useAuth();
  const [location, navigate] = useLocation();
  const me = trpc.system.saas.me.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const isProductRoot = location === "/product" || location === "/driver";
  const isLegacyProductWorld = location === "/product/hq";
  const isLegacyProductField = location === "/product/field" || location === "/driver";
  const isField = isLegacyProductField || location === "/product/unload" || location === "/product/hunt";
  const isHq = !isField;
  const canUseHq = me.data?.membership.role !== "field";

  useEffect(() => {
    if (!me.data) return;
    if (isProductRoot) {
      const mobile = window.matchMedia("(max-width: 760px)").matches;
      navigate(mobile || !canUseHq ? "/play" : "/growth/lantern-city", { replace: true });
      return;
    }
    if (isLegacyProductField) {
      navigate("/play", { replace: true });
      return;
    }
    if (isLegacyProductWorld) {
      navigate(canUseHq ? "/growth/lantern-city" : "/play", { replace: true });
      return;
    }
    if (!canUseHq && isHq) navigate("/play", { replace: true });
  }, [
    me.data,
    isProductRoot,
    isLegacyProductField,
    isLegacyProductWorld,
    isHq,
    canUseHq,
    navigate,
  ]);

  if (loading || (isAuthenticated && me.isLoading)) return <main className="cc-product grid place-items-center"><Loader2 className="animate-spin" /></main>;
  if (!isAuthenticated) return <LoginForm role="admin" onSuccess={() => window.location.reload()} />;
  const operatingName = me.data?.configuration?.tenant.brandName;
  return (
    <main className="cc-product">
      <header className="cc-topbar">
        <Link href={canUseHq ? "/growth/lantern-city" : "/play"} className="cc-brand"><strong>{PRODUCT_NAME}</strong><small>{operatingName ?? "Operate the real business"}</small></Link>
        <nav className="cc-camera-switch" aria-label="JOYSTICK view">
          <Link href="/play" className={isField ? "active" : ""}>Play</Link>
          {canUseHq ? <Link href="/growth/lantern-city" className={isHq ? "active" : ""}>World</Link> : null}
        </nav>
        <div className="cc-top-actions">
          <Link href="/dayforge-settings" className="cc-button">Account</Link>
        </div>
      </header>
      <div className="cc-shell-body">{location === "/product/unload" ? <UnloadView /> : location === "/product/hunt" ? <HuntView /> : isField ? <FieldHome /> : <HqHome />}</div>
    </main>
  );
}