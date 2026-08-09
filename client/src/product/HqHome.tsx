import { Link, useLocation } from "wouter";
import WorldView from "./WorldView";
import CustomerVault from "./CustomerVault";
import GrowView from "./GrowView";
import MoneyView from "./MoneyView";
import CapabilitiesView from "./CapabilitiesView";
import TeamView from "./TeamView";
import { trpc } from "@/lib/trpc";

const baseTabs = [
  ["World", "/product/hq"], ["Customer Vault", "/product/customers"], ["Grow", "/product/grow"],
  ["Money", "/product/money"], ["Capabilities", "/product/capabilities"],
] as const;

export default function HqHome() {
  const [location] = useLocation();
  const team = trpc.system.team.get.useQuery();
  const tabs = team.data?.active ? [...baseTabs, ["Team", "/product/team"] as const] : baseTabs;
  const content = location.startsWith("/product/customer") || location === "/product/customers"
    ? <CustomerVault />
    : location === "/product/grow" ? <GrowView />
    : location === "/product/money" ? <MoneyView />
    : location === "/product/capabilities" ? <CapabilitiesView />
    : location === "/product/team" ? <TeamView />
    : <WorldView />;
  return <><nav className="cc-hq-tabs" aria-label="HQ areas">{tabs.map(([label,path]) => <Link key={path} href={path} className={(path === "/product/hq" ? location === path : location.startsWith(path)) ? "active" : ""}>{label}</Link>)}</nav>{content}</>;
}
