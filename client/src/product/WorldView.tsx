import {
  ArrowRight,
  Banknote,
  Building2,
  CircleDollarSign,
  Compass,
  LockKeyhole,
  MapPinOff,
  ShieldAlert,
  Sparkles,
  Truck,
  UsersRound,
  Warehouse,
} from "lucide-react";
import type { CSSProperties } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import type { WorldPoint } from "../../../server/businessWorld/businessWorldTypes";

function dollars(cents: number | null | undefined): string {
  return cents == null
    ? "Unknown"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(cents / 100);
}

function words(value: string): string {
  return value.replace(/_/g, " ");
}

function worldChangeLabel(title: string): string {
  const normalized = title.toLowerCase();
  if (normalized.includes("walk in"))
    return "A commercial visit entered the world";
  if (normalized.includes("payment") || normalized.includes("paid"))
    return "Collected money strengthened Treasury";
  if (normalized.includes("completed"))
    return "Completed work strengthened the portfolio";
  if (normalized.includes("won")) return "A commercial relationship advanced";
  return "A verified business event changed the world";
}

function customerState(
  point: WorldPoint
): "healthy" | "watch" | "risk" | "quiet" {
  if (point.customerAsset?.health === "at_risk") return "risk";
  if ((point.customerAsset?.outstandingReceivables.value ?? 0) > 0)
    return "watch";
  if (point.customerAsset?.health === "healthy") return "healthy";
  return "quiet";
}

function PropertyBuilding({
  point,
  commercial = false,
  landmark = false,
}: {
  point: WorldPoint;
  commercial?: boolean;
  landmark?: boolean;
}) {
  const [, navigate] = useLocation();
  const asset = point.customerAsset;
  const receivable = asset?.outstandingReceivables.value ?? 0;
  const state = customerState(point);
  const commercialEstimate = asset?.commercial?.estimatedAnnualValue.value;
  const realized = asset?.commercial?.realizedRevenue.value;
  const value = commercial
    ? realized && realized > 0
      ? `${dollars(realized)} realized`
      : commercialEstimate != null
        ? `${dollars(commercialEstimate)} est. annual`
        : "Value unknown"
    : point.value?.value != null
      ? `${dollars(point.value.value)} collected`
      : "Value unknown";

  return (
    <button
      type="button"
      className={`cc-property-object ${commercial ? "commercial" : "residential"} ${landmark ? "landmark" : ""} ${state}`}
      onClick={() => point.detailPath && navigate(point.detailPath)}
      aria-label={`Open ${point.name}. ${value}.`}
    >
      <span className="cc-property-lot" aria-hidden="true">
        <span className="cc-property-tree" />
        <span className="cc-property-building">
          <span className="cc-property-roof" />
          <span className="cc-property-windows" />
          <span className="cc-property-door" />
        </span>
        {state === "risk" ? (
          <span className="cc-property-beacon danger">
            <ShieldAlert size={13} />
          </span>
        ) : null}
        {receivable > 0 ? (
          <span className="cc-stuck-money">
            <CircleDollarSign size={12} /> {dollars(receivable)} due
          </span>
        ) : null}
      </span>
      <span className="cc-property-plate">
        <strong>{point.name}</strong>
        <small>{value}</small>
        <span className="cc-property-meta">
          {commercial
            ? words(asset?.commercial?.stage ?? point.state)
            : words(point.state)}
          {point.geoStatus === "unresolved" ? (
            <MapPinOff size={11} aria-label="Exact location unverified" />
          ) : null}
        </span>
      </span>
    </button>
  );
}

export default function WorldView() {
  const world = trpc.system.businessWorld.get.useQuery();

  if (world.isLoading) {
    return (
      <section className="cc-world">
        <div className="cc-world-loading">Building your real company…</div>
      </section>
    );
  }
  if (!world.data) {
    return (
      <section className="cc-world">
        <div className="cc-world-loading">
          {world.error?.message ?? "WORLD unavailable"}
        </div>
      </section>
    );
  }

  const data = world.data;
  const maxCommercialValue = Math.max(
    0,
    ...data.commercialAssets.map(point =>
      Math.max(
        point.customerAsset?.commercial?.estimatedAnnualValue.value ?? 0,
        point.customerAsset?.commercial?.realizedRevenue.value ?? 0
      )
    )
  );
  const firstHireAvailable = data.capabilities.includes("FIRST_HIRE_READY");
  const hasTeam = data.teamSummary.activeNonOwnerMembers > 0;
  const unresolvedCount = [...data.properties, ...data.commercialAssets].filter(
    point => point.geoStatus === "unresolved"
  ).length;

  return (
    <section className="cc-world">
      <header className="cc-world-intro">
        <div>
          <p className="cc-eyebrow">HQ camera · {words(data.business.stage)}</p>
          <h1>{data.business.brandName} World</h1>
          <p className="cc-world-subtitle">
            Every property and state is real. This portfolio layout is not exact
            geography.
          </p>
        </div>
        <div className="cc-world-live-line">
          <span>
            <Compass size={15} />{" "}
            {data.properties.length + data.commercialAssets.length} real assets
          </span>
          <span className={data.openThreats.length ? "danger" : ""}>
            <ShieldAlert size={15} /> {data.openThreats.length} sourced alerts
          </span>
          <span>
            <MapPinOff size={15} /> {unresolvedCount} exact locations unverified
          </span>
        </div>
      </header>

      <div
        className="cc-tycoon-world"
        style={
          { "--tenant-color": data.business.primaryColor } as CSSProperties
        }
      >
        <div className="cc-world-sky" aria-hidden="true">
          <span className="cc-world-sun" />
          <span className="cc-cloud one" />
          <span className="cc-cloud two" />
          <span className="cc-world-skyline" />
        </div>
        <div className="cc-world-water" aria-hidden="true" />
        <div className="cc-world-road main" aria-hidden="true" />
        <div className="cc-world-road cross" aria-hidden="true" />

        <section
          className="cc-world-hub"
          aria-label="Company headquarters and resources"
        >
          <Link
            href="/product/money"
            className="cc-world-object cc-treasury-object"
          >
            <span className="cc-object-kicker">
              <Banknote size={14} /> Business resource
            </span>
            <span className="cc-treasury-art" aria-hidden="true">
              <span className="cc-treasury-roof" />
              <span className="cc-vault-door">
                <CircleDollarSign size={27} />
              </span>
              <span className="cc-coin-stack one" />
              <span className="cc-coin-stack two" />
            </span>
            <span className="cc-world-object-copy">
              <small>Treasury</small>
              <strong>
                {dollars(data.financialSummary.collectedRevenue.value)}
              </strong>
              <span>
                Collected from real payments <ArrowRight size={13} />
              </span>
            </span>
          </Link>

          <div className="cc-hq-campus">
            <div className="cc-hq-stage-flag">{words(data.business.stage)}</div>
            <div
              className="cc-hq-building-art"
              aria-label={`${data.business.brandName} headquarters`}
            >
              <span className="cc-hq-roof" />
              <span className="cc-hq-sign">
                <Warehouse size={15} /> {data.business.brandName}
              </span>
              <span className="cc-hq-office-windows" />
              <span className="cc-garage-door one" />
              <span className="cc-garage-door two" />
            </div>
            <Link
              href="/product/field"
              className="cc-owner-van"
              aria-label="Open FIELD with the owner vehicle"
            >
              <span className="cc-van-box">{data.business.brandName}</span>
              <span className="cc-van-cab" />
              <span className="cc-van-wheel one" />
              <span className="cc-van-wheel two" />
              <small>
                Owner route <Truck size={12} />
              </small>
            </Link>
            <p className="cc-hq-caption">The company you are building</p>
          </div>

          <Link
            href={hasTeam ? "/product/team" : "/product/capabilities"}
            className={`cc-world-object cc-expansion-object ${firstHireAvailable || hasTeam ? "ready" : "locked"}`}
          >
            <span className="cc-object-kicker">
              {hasTeam ? <UsersRound size={14} /> : <LockKeyhole size={14} />}
              {hasTeam ? "Team active" : "Future capacity"}
            </span>
            <span className="cc-expansion-art" aria-hidden="true">
              <span className="cc-expansion-frame" />
              <span className="cc-expansion-parking">2</span>
              {!firstHireAvailable && !hasTeam ? (
                <span className="cc-expansion-lock">
                  <LockKeyhole />
                </span>
              ) : null}
            </span>
            <span className="cc-world-object-copy">
              <small>{hasTeam ? "Team yard" : "Second vehicle bay"}</small>
              <strong>
                {hasTeam
                  ? `${data.teamSummary.activeNonOwnerMembers} active`
                  : firstHireAvailable
                    ? "Ready to inspect"
                    : "Locked"}
              </strong>
              <span>
                {hasTeam
                  ? "Open real allocation"
                  : "Business conditions decide"}{" "}
                <ArrowRight size={13} />
              </span>
            </span>
          </Link>
        </section>

        <div className="cc-cash-route" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>

        <section className="cc-world-district cc-neighborhood-district">
          <header className="cc-district-sign">
            <span className="cc-district-icon">
              <Building2 size={18} />
            </span>
            <div>
              <small>Residential portfolio</small>
              <h2>Unmapped Neighborhood</h2>
            </div>
            <p>
              <MapPinOff size={13} /> Real customers · exact placement
              unverified
            </p>
          </header>
          {data.properties.length ? (
            <div className="cc-property-grid residential-grid">
              {data.properties.map(point => (
                <PropertyBuilding key={point.id} point={point} />
              ))}
            </div>
          ) : (
            <div className="cc-world-empty-lot">
              <span />
              No residential customer assets yet.
            </div>
          )}
        </section>

        <section className="cc-world-district cc-commercial-district">
          <header className="cc-district-sign purple">
            <span className="cc-district-icon">
              <Building2 size={18} />
            </span>
            <div>
              <small>Commercial relationships</small>
              <h2>Commerce Boulevard</h2>
            </div>
            <p>Building scale follows known economic significance</p>
          </header>
          {data.commercialAssets.length ? (
            <div className="cc-property-grid commercial-grid">
              {data.commercialAssets.map(point => {
                const economicValue = Math.max(
                  point.customerAsset?.commercial?.estimatedAnnualValue.value ??
                    0,
                  point.customerAsset?.commercial?.realizedRevenue.value ?? 0
                );
                return (
                  <PropertyBuilding
                    key={point.id}
                    point={point}
                    commercial
                    landmark={
                      maxCommercialValue > 0 &&
                      economicValue >= maxCommercialValue * 0.65
                    }
                  />
                );
              })}
            </div>
          ) : (
            <div className="cc-world-empty-lot">
              <span />
              No commercial relationships are established yet.
            </div>
          )}
        </section>

        <Link href="/product/grow" className="cc-growth-zone">
          <span className="cc-growth-land" aria-hidden="true">
            <span className="cc-growth-path" />
            <span className="cc-growth-flag one" />
            <span className="cc-growth-flag two" />
            <span className="cc-growth-sprout one" />
            <span className="cc-growth-sprout two" />
            <span className="cc-growth-sprout three" />
          </span>
          <span className="cc-growth-copy">
            <small>
              <Sparkles size={13} /> Growth district
            </small>
            <strong>
              {data.growthSignals.length
                ? `${data.growthSignals.length} sourced signals`
                : "Quiet right now"}
            </strong>
            <span>
              {data.growthSignals[0]?.title ??
                "Only eligible moves appear here"}{" "}
              <ArrowRight size={13} />
            </span>
          </span>
        </Link>

        <section
          className="cc-world-change-ribbon"
          aria-label="Recent verified world changes"
        >
          <header>
            <Sparkles size={16} />
            <div>
              <small>Unload the Day reveals this</small>
              <strong>Today changed your company</strong>
            </div>
          </header>
          <div className="cc-change-track">
            {data.recentChanges.length ? (
              data.recentChanges.slice(0, 5).map(change => (
                <span
                  key={change.id}
                  title={`${change.title} · ${change.sourceReference}`}
                >
                  <i className={change.verificationClass.toLowerCase()} />
                  <b>{worldChangeLabel(change.title)}</b>
                  <small>
                    {new Date(change.occurredAt).toLocaleDateString()} ·{" "}
                    {change.verificationClass}
                  </small>
                </span>
              ))
            ) : (
              <span>
                <b>No sourced changes yet today.</b>
                <small>The world stays still when the evidence is still.</small>
              </span>
            )}
          </div>
        </section>
      </div>

      <details className="cc-world-truth-drawer">
        <summary>World truth and source health</summary>
        <p>
          {data.dataQuality.status}. {data.dataQuality.warnings.join(" · ")}
        </p>
        <p>
          Generated {new Date(data.generatedAt).toLocaleString()} from{" "}
          {data.dataQuality.sources.join(", ")}.
        </p>
      </details>
    </section>
  );
}
