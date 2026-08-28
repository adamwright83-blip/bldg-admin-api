import { Archive, ArrowRight, Backpack, Binoculars, BookOpenCheck, RadioTower, Shield, UsersRound } from "lucide-react";
import { Link } from "wouter";

const CAPABILITIES = [
  { slug: "overlook", title: "The Overlook", subtitle: "Scout", icon: Binoculars, status: "available", detail: "Commercial mission and territory discovery surfaces are implemented.", href: "/commercial-missions", kind: "capability" },
  { slug: "archive", title: "The Archive", subtitle: "Intel", icon: Archive, status: "available", detail: "Persisted Sales Intelligence sources and reviewed teachings are available.", href: "/sales-intel", kind: "capability" },
  { slug: "beacon", title: "The Beacon", subtitle: "Follow-Up", icon: RadioTower, status: "available", detail: "Persisted commercial follow-up work is exposed through the existing Today queue.", href: "/dayforge-today", kind: "capability" },
  { slug: "long-table", title: "The Long Table", subtitle: "Relationship", icon: UsersRound, status: "available", detail: "Commercial relationship state is governed in the persisted pipeline.", href: "/commercial-pipeline", kind: "capability" },
  { slug: "armory", title: "The Armory", subtitle: "Sales Intelligence", icon: Shield, status: "available", detail: "Source registration, curation, review, and teaching governance are implemented.", href: "/sales-intel", kind: "workspace" },
  { slug: "field-kit", title: "The Field Kit", subtitle: "Physical Loadout", icon: Backpack, status: "unavailable", detail: "No authoritative physical inventory or supply-room contract is configured.", href: null, kind: "workspace" },
  { slug: "ledger-room", title: "The Ledger Room", subtitle: "Action Detail", icon: BookOpenCheck, status: "available", detail: "Operational event history provides literal action evidence.", href: "/operations-events", kind: "workspace" },
] as const;

export default function DriverIntelligenceOverview({ path }: { path: string }) {
  const selectedSlug = path.split("/").pop();
  const selected = CAPABILITIES.find(item => item.slug === selectedSlug);
  const visible = selected && selectedSlug !== "driver-intelligence" ? [selected] : CAPABILITIES;
  return <main className="di-page"><header><span>Growth · Driver Intelligence</span><h1>Admin governs the machinery.</h1><p>Goldline embodies these capabilities during field execution. This view reports what is actually implemented; it does not manufacture agent output.</p></header><section className="di-grid">{visible.map(item => { const Icon = item.icon; return <article key={item.slug} className={`status-${item.status}`}><div className="di-icon"><Icon /></div><span>{item.kind}</span><h2>{item.title} <small>— {item.subtitle}</small></h2><p>{item.detail}</p><div className="di-card-foot"><b>{item.status === "available" ? "Available" : "Not configured"}</b>{item.href ? <Link href={item.href}>Open evidence <ArrowRight /></Link> : <span>Awaiting authoritative seam</span>}</div></article>; })}</section></main>;
}
