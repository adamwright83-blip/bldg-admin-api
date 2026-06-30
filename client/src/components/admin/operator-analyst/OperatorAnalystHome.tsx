import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Info,
  Layers3,
  Star,
} from "lucide-react";
import { ComposerPanel } from "../ComposerPanel";

const ASSET_BASE = "/admin-assets/operator-analyst";

const demoMetrics = [
  {
    label: "Weekly Revenue",
    value: "$18,642",
    delta: "7.6%",
    icon: `${ASSET_BASE}/spark.png`,
  },
  {
    label: "Orders",
    value: "354",
    delta: "6.8%",
    icon: `${ASSET_BASE}/icons/orders.png`,
  },
  {
    label: "Repeat Customers",
    value: "268",
    delta: "8.2%",
    icon: `${ASSET_BASE}/icons/repeat-customers.png`,
  },
  {
    label: "Pickup & Delivery",
    value: "87",
    delta: "14.1%",
    icon: `${ASSET_BASE}/icons/pickup-delivery.png`,
  },
  {
    label: "Utilization",
    value: "78%",
    delta: "3.4 pts",
    icon: `${ASSET_BASE}/icons/machine-utilization.png`,
  },
  {
    label: "Store Health",
    value: "Excellent",
    delta: "Stronger than last week",
    icon: `${ASSET_BASE}/icons/store-health.png`,
  },
];

const glanceMetrics = [
  ["Open Orders", "28"],
  ["Unpaid Orders", "$1,285"],
  ["Overdue Pickups", "14"],
  ["At-Risk Customers", "23"],
  ["Reviews", "4.8/5"],
];

function DemoStoreSidebarCard() {
  return (
    <aside className="oa-sidebar" aria-label="Demo store">
      <img className="oa-wordmark" src={`${ASSET_BASE}/bldg-wordmark.png`} alt="Bldg." />
      <button className="oa-store-card" type="button">
        <img src={`${ASSET_BASE}/demo-store-sun.png`} alt="" />
        <span>
          <strong>Bright Day Laundry</strong>
          <small>Sample Store</small>
        </span>
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </button>
      <nav className="oa-nav" aria-label="Demo navigation">
        {["Home", "Performance", "Orders", "Customers", "Machines", "Staff"].map((item, index) => (
          <span key={item} className={index === 0 ? "is-active" : ""}>
            {item}
          </span>
        ))}
      </nav>
      <div className="oa-demo-card">
        <Star className="h-4 w-4" aria-hidden="true" />
        <span>
          <strong>Demo Mode</strong>
          <small>Sample Store Data</small>
        </span>
        <Info className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="oa-owner-card">
        <img src={`${ASSET_BASE}/demo-owner-rachel.png`} alt="" />
        <span>
          <strong>Rachel Owner</strong>
          <small>Owner</small>
        </span>
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </div>
    </aside>
  );
}

function PerformancePathHero() {
  return (
    <section className="oa-performance-hero" aria-label="Sample store weekly performance">
      <div className="oa-hero-topline">
        <div>
          <h2>Good morning, Rachel.</h2>
          <p>Here’s how your store is performing.</p>
        </div>
        <div className="oa-mode-date">
          <span>
            <i />
            Demo Mode
            <small>Sample Store Data</small>
          </span>
          <button type="button">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            May 14 – May 20, 2025
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="oa-path-card">
        <img className="oa-path-bg" src={`${ASSET_BASE}/performance-path-hero.png`} alt="" />
        <div className="oa-path-metrics">
          {demoMetrics.map((metric) => (
            <article key={metric.label} className="oa-path-metric">
              <img src={metric.icon} alt="" />
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>+ {metric.delta}</small>
            </article>
          ))}
        </div>
        <div className="oa-glance-strip">
          <strong>This Week at a Glance</strong>
          {glanceMetrics.map(([label, value]) => (
            <span key={label}>
              <small>{label}</small>
              <b>
                {label === "Reviews" ? <Star className="h-4 w-4" aria-hidden="true" /> : null}
                {value}
              </b>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProvenanceReceipt() {
  return (
    <section className="oa-provenance" aria-label="Provenance receipt">
      <div>
        <img src={`${ASSET_BASE}/store-health-medallion.png`} alt="" />
        <span>
          <strong>Provenance Receipt</strong>
          <small>Transparent by design. Every insight is traceable.</small>
        </span>
      </div>
      <span>
        <strong>Data Sources</strong>
        <small>POS, orders, customers, machines, staff, reviews</small>
      </span>
      <span>
        <strong>Time Window</strong>
        <small>May 14 – May 20, 2025</small>
      </span>
      <span>
        <strong>Generated</strong>
        <small>Demo sample, updated 1 hour ago</small>
      </span>
    </section>
  );
}

export function OperatorAnalystHome({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <section className="oa-home" aria-label="Operator Analyst demo mode homepage">
      <DemoStoreSidebarCard />
      <div className="oa-main">
        <PerformancePathHero />
        <ComposerPanel
          className="oa-composer"
          defaultDemoMode
          onNavigate={onNavigate}
          variant="operator-home"
        />
        <ProvenanceReceipt />
      </div>
      <div className="oa-floating-source">
        <Layers3 className="h-4 w-4" aria-hidden="true" />
        Sources & Notes
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
      </div>
    </section>
  );
}
