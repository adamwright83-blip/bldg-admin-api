import { lazy, Suspense } from "react";
import { Link, useLocation } from "wouter";

const LanternCityIslands = lazy(
  () => import("@/components/admin/control-room/LanternCityIslands/LanternCityIslands")
);
import { PRODUCT_NAME } from "@shared/productIdentity";
import "./product.css";

/**
 * Commercial JOYSTICK world surface.
 *
 * This deliberately reuses the canonical Lantern City renderer while omitting
 * Laundry Butler/platform-admin shortcuts. All data it reads is tenant-scoped.
 */
export default function JoystickWorld() {
  const [, navigate] = useLocation();

  return (
    <main className="cc-product">
      <header className="cc-topbar">
        <Link href="/growth/lantern-city" className="cc-brand">
          <strong>{PRODUCT_NAME}</strong>
          <small>Lantern City</small>
        </Link>
        <nav className="cc-camera-switch" aria-label="JOYSTICK view">
          <Link href="/growth/lantern-city" className="active">
            World
          </Link>
          <Link href="/play">Play</Link>
        </nav>
        <div className="cc-top-actions">
          <Link href="/product/customers" className="cc-button">
            Customers
          </Link>
          <Link href="/product/money" className="cc-button">
            Money
          </Link>
          <Link href="/billing" className="cc-button">
            Account
          </Link>
        </div>
      </header>
      <div className="cc-shell-body">
        <Suspense fallback={<div className="cc-empty">Raising Lantern City…</div>}>
          <LanternCityIslands
            showUtilityDock={false}
            onOpenCustomer={() => navigate("/product/customers")}
            onNavigate={navigate}
          />
        </Suspense>
      </div>
    </main>
  );
}
