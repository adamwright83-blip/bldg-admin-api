import { ArrowLeft } from "lucide-react";
import { Link, useLocation } from "wouter";
import CapabilitiesView from "./CapabilitiesView";
import CustomerVault from "./CustomerVault";
import GrowView from "./GrowView";
import MoneyView from "./MoneyView";
import TeamView from "./TeamView";
import WorldView from "./WorldView";

const detailLabels: Record<string, string> = {
  "/product/customers": "Customer Vault",
  "/product/grow": "Growth District",
  "/product/money": "Treasury",
  "/product/capabilities": "Expansion Yard",
  "/product/team": "Team Yard",
};

export default function HqHome() {
  const [location] = useLocation();
  const isCustomer = location.startsWith("/product/customer");
  const detail = isCustomer ? (
    <CustomerVault />
  ) : location === "/product/grow" ? (
    <GrowView />
  ) : location === "/product/money" ? (
    <MoneyView />
  ) : location === "/product/capabilities" ? (
    <CapabilitiesView />
  ) : location === "/product/team" ? (
    <TeamView />
  ) : null;

  if (!detail) return <WorldView />;

  return (
    <section className="cc-world-detail-stage">
      <nav className="cc-world-breadcrumb" aria-label="WORLD location">
        <Link href="/product/hq">
          <ArrowLeft size={15} /> Return to World
        </Link>
        <span>{isCustomer ? "Customer property" : detailLabels[location]}</span>
      </nav>
      {detail}
    </section>
  );
}
