import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Loader2, Plus } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { trpc } from "@/lib/trpc";
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
  const isField = location.startsWith("/product/field") || location === "/product/unload" || location === "/product/hunt" || location === "/driver";
  const isHq = !isField;
  const canUseHq = me.data?.membership.role !== "field";

  useEffect(() => {
    if (!me.data) return;
    if (isProductRoot) {
      const mobile = window.matchMedia("(max-width: 760px)").matches;
      navigate(mobile || !canUseHq ? "/product/field" : "/product/hq", { replace: true });
    } else if (!canUseHq && isHq) navigate("/product/field", { replace: true });
  }, [me.data, isProductRoot, isHq, canUseHq, navigate]);

  if (loading || (isAuthenticated && me.isLoading)) return <main className="cc-product grid place-items-center"><Loader2 className="animate-spin" /></main>;
  if (!isAuthenticated) return <LoginForm role="admin" onSuccess={() => window.location.reload()} />;
  const brandName = me.data?.configuration?.tenant.brandName ?? "Laundry Butler";
  return (
    <main className="cc-product">
      <header className="cc-topbar">
        <Link href={canUseHq ? "/product/hq" : "/product/field"} className="cc-brand"><strong>{brandName}</strong><small>Operate the real business</small></Link>
        <nav className="cc-camera-switch" aria-label="Business camera">
          <Link href="/product/field" className={isField ? "active" : ""}>Field</Link>
          {canUseHq ? <Link href="/product/hq" className={isHq ? "active" : ""}>HQ</Link> : null}
        </nav>
        <div className="cc-top-actions">
          <Link href="/new-order" className="cc-button primary"><Plus size={16} /> New laundry order</Link>
          <Link href="/admin" className="cc-button">Legacy operations</Link>
        </div>
      </header>
      <div className="cc-shell-body">{location === "/product/unload" ? <UnloadView /> : location === "/product/hunt" ? <HuntView /> : isField ? <FieldHome /> : <HqHome />}</div>
    </main>
  );
}
