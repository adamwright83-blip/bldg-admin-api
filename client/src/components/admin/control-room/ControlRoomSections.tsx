import { ArrowRight, Clock3, MapPin, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { TowerWars } from "./TowerWars";
import { BuildingStrata } from "./BuildingStrata";
import { CanonicalBuildingSeam } from "./CanonicalBuildingSeam";

const ASSET_ROOT = "/assets/admin/control-room";

function dollarsFromCents(value: number | null | undefined) {
  if (typeof value !== "number") return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function SectionIntro({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <header className="cr-section-intro">
      <div>
        <span className="cr-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      <div className="cr-authoritative-badge">
        <ShieldCheck className="h-5 w-5" />
        <span>
          <strong>Authoritative view</strong>
          <small>Truth remains source-labeled</small>
        </span>
      </div>
    </header>
  );
}

function DestinationCard({
  icon,
  title,
  copy,
  href,
}: {
  icon: string;
  title: string;
  copy: string;
  href: string;
}) {
  return (
    <Link href={href} className="cr-destination-card">
      <img src={`${ASSET_ROOT}/nav/${icon}.svg`} alt="" />
      <span>
        <strong>{title}</strong>
        <p>{copy}</p>
      </span>
      <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

export function GrowthControlRoom({
  onNavigate,
}: {
  onNavigate: (path: string) => void;
}) {
  return (
    <main className="cr-section-page">
      <SectionIntro
        eyebrow="GROWTH · ACCOUNT PERFORMANCE"
        title="Growth"
        copy="Understand what converted, what realized value, and which relationship needs management follow-up. Field execution stays in Goldline."
      />
      <TowerWars onNavigate={onNavigate} compact />
      <BuildingStrata />
      <CanonicalBuildingSeam />
      <section className="cr-destination-grid" aria-label="Growth workspaces">
        <DestinationCard
          icon="growth"
          title="Commercial pipeline"
          copy="Relationship stages, follow-ups, proposals, and realized value."
          href="/commercial-pipeline"
        />
        <DestinationCard
          icon="customers"
          title="Churn radar"
          copy="Evidence-backed customer recovery and approval boundaries."
          href="/churn-radar"
        />
        <DestinationCard
          icon="growth"
          title="Revenue radar"
          copy="Commercial opportunity and attributed outcomes."
          href="/commercial-missions"
        />
        <DestinationCard
          icon="settings"
          title="Sales intelligence"
          copy="Source registry, teachings, and reviewed commercial knowledge."
          href="/sales-intel"
        />
      </section>
    </main>
  );
}

export function MoneyControlRoom() {
  const collected = trpc.admin.getCollectedToday.useQuery();
  const awaiting = trpc.admin.getAwaitingPayment.useQuery();
  const dashboard = trpc.admin.dashboardSummary.useQuery();
  return (
    <main className="cr-section-page">
      <SectionIntro
        eyebrow="MONEY · PAYMENT & RECONCILIATION"
        title="Money"
        copy="Collected funds, receivables, reconciliation, and advanced P&L stay distinct so confidence never outruns the source."
      />
      <section className="cr-finance-grid">
        <article>
          <img src={`${ASSET_ROOT}/status/success.svg`} alt="" />
          <span>Collected today</span>
          <strong>
            {collected.data?.dbAvailable
              ? dollarsFromCents(collected.data.cents)
              : "Unavailable"}
          </strong>
          <small>
            {collected.data?.processorLabel ?? "Payment source unavailable"}
          </small>
        </article>
        <article>
          <img src={`${ASSET_ROOT}/status/action-required.svg`} alt="" />
          <span>Awaiting payment</span>
          <strong>
            {awaiting.data?.dbAvailable
              ? dollarsFromCents(awaiting.data.cents)
              : "Unavailable"}
          </strong>
          <small>Open receivable pipeline</small>
        </article>
        <article>
          <img src={`${ASSET_ROOT}/status/info.svg`} alt="" />
          <span>Revenue this month</span>
          <strong>
            {dashboard.data
              ? new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 0,
                }).format(dashboard.data.revenueMonth)
              : "Unavailable"}
          </strong>
          <small>
            {dashboard.data?.revenueTimestampBasis
              ? `Basis: ${dashboard.data.revenueTimestampBasis}`
              : "Timestamp basis unavailable"}
          </small>
        </article>
      </section>
      <section className="cr-destination-grid" aria-label="Money workspaces">
        <DestinationCard
          icon="money"
          title="Payment reconciliation"
          copy="Resolve money owed and processor/order mismatches."
          href="/payment-reconciliation"
        />
        <DestinationCard
          icon="money"
          title="True P&L cockpit"
          copy="Open the advanced financial view without replacing basic payment truth."
          href="/pnl"
        />
      </section>
    </main>
  );
}

export function GrowthBuildingsPage() {
  const customers = trpc.admin.listCustomers.useQuery(
    { sortBy: "spend", includeLegacyCleanCloud: true },
    { staleTime: 60_000 }
  );
  const buildings = Object.entries(
    customers.data?.buildingSummary ?? {}
  ).filter(([slug]) => slug !== "unknown");
  return (
    <main className="cr-section-page">
      <SectionIntro
        eyebrow="GROWTH · BUILDING EVIDENCE"
        title="Buildings"
        copy="Literal building performance behind the symbolic world. Counts and revenue come from the customer aggregate."
      />
      <section className="cr-finance-grid">
        {customers.isLoading ? (
          <div className="cr-loading-line">Reading building aggregates…</div>
        ) : buildings.length ? (
          buildings.map(([slug, building]) => (
            <article key={slug}>
              <img src={`${ASSET_ROOT}/nav/growth.svg`} alt="" />
              <span>{slug.replace(/-/g, " ")}</span>
              <strong>{building.totalCustomers} customers</strong>
              <small>
                {building.activeCustomers} active ·{" "}
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 0,
                }).format(building.totalRevenue)}{" "}
                revenue
              </small>
            </article>
          ))
        ) : (
          <div className="cr-empty-state">
            <div>
              <strong>No mapped building aggregate</strong>
              <p>
                Customers without an authoritative building remain outside this
                view.
              </p>
            </div>
          </div>
        )}
      </section>
      <section className="cr-destination-grid">
        <DestinationCard
          icon="customers"
          title="Open literal customers"
          copy="Inspect customer and order evidence."
          href="/customers"
        />
        <DestinationCard
          icon="growth"
          title="Open Lantern City"
          copy="Return to the symbolic relationship atlas."
          href="/growth/lantern-city"
        />
      </section>
    </main>
  );
}

export function GrowthOffersPage() {
  return (
    <main className="cr-section-page">
      <SectionIntro
        eyebrow="GROWTH · OFFERS"
        title="Offers"
        copy="Offer work appears only when it is backed by a configured proposal or fulfillment rule."
      />
      <div className="cr-empty-state">
        <img src={`${ASSET_ROOT}/status/info.svg`} alt="" />
        <div>
          <strong>No active offer inventory query is configured</strong>
          <p>
            Tower Wars will not claim referral, loyalty, or presentation
            readiness until an authoritative rule and persisted fulfillment
            instruction exist.
          </p>
        </div>
      </div>
      <section className="cr-destination-grid">
        <DestinationCard
          icon="settings"
          title="Proposal configuration"
          copy="Open the existing commercial proposal settings without creating fake offer state."
          href="/commercial-proposal-settings"
        />
        <DestinationCard
          icon="growth"
          title="Commercial pipeline"
          copy="Inspect persisted account opportunities and values."
          href="/commercial-pipeline"
        />
      </section>
    </main>
  );
}

function localBusinessDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function SettingsControlRoom() {
  const director = trpc.system.dayDirector.state.useQuery(
    { businessDate: localBusinessDate() },
    { retry: false }
  );
  const location = director.data?.processingLocation;
  return (
    <main className="cr-section-page">
      <SectionIntro
        eyebrow="SETTINGS · BUSINESS CONFIGURATION"
        title="Settings"
        copy="Authoritative operating configuration belongs here. Goldline consumes these facts for field execution."
      />
      <section className="cr-settings-grid">
        <article className="cr-processing-center">
          <div className="cr-setting-icon">
            <MapPin className="h-5 w-5" />
          </div>
          <span>PROCESSING CENTER</span>
          <strong>
            {location?.name ??
              (director.isLoading
                ? "Reading configuration…"
                : "Not configured")}
          </strong>
          <p>
            {location?.address ||
              location?.locality ||
              "No active tenant-scoped processing location is available."}
          </p>
          <small>
            <Clock3 className="h-3.5 w-3.5" /> Used by Day Director for the
            operational handoff
          </small>
        </article>
        <Link href="/catalog" className="cr-setting-link">
          <img src={`${ASSET_ROOT}/nav/settings.svg`} alt="" />
          <span>
            <small>CATALOG &amp; PRICING</small>
            <strong>Price list</strong>
            <p>
              Service types, standard and express pricing, cost, margin, and
              online availability.
            </p>
          </span>
          <ArrowRight className="h-5 w-5" />
        </Link>
      </section>
      <div className="cr-config-note">
        <img src={`${ASSET_ROOT}/status/info.svg`} alt="" />
        <p>
          The processing center is read from the existing tenant-scoped Day
          Director configuration. No duplicate Driver setting has been created.
        </p>
      </div>
    </main>
  );
}
