import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  Gamepad2,
  MapPin,
  Navigation,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  COMMERCIAL_MISSION_DEMO_STORAGE_KEY,
  DEMO_OPPORTUNITIES,
  formatCurrencyFromCents,
  type CommercialMission,
  type CommercialOpportunity,
} from "@shared/commercialMission";
import { buildCommercialMissionFromOpportunity } from "@shared/commercialMissionFactory";
import "./territory-preview.css";

const SCHEDULER_URL: string | undefined = import.meta.env.VITE_SCHEDULER_URL;

type PreviewPhase = "entry" | "scanning" | "results" | "mission";

function OpportunityCard({
  opportunity,
  active,
  onSelect,
}: {
  opportunity: CommercialOpportunity;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`tp-opportunity${active ? " is-active" : ""}`}
      type="button"
      onClick={onSelect}
      aria-pressed={active}
    >
      <span className="tp-opportunity-icon" aria-hidden="true">
        <Building2 />
      </span>
      <span className="tp-opportunity-copy">
        <strong>{opportunity.accountName}</strong>
        <small>
          {opportunity.accountType} · {opportunity.locationCount} location
          {opportunity.locationCount === 1 ? "" : "s"} · {opportunity.distanceMiles} mi
        </small>
        <em>{opportunity.primarySignal}</em>
      </span>
      <span className="tp-opportunity-score">
        <b>{opportunity.score}</b>
        <small>fit score</small>
      </span>
      <span className="tp-opportunity-value">
        <b>{formatCurrencyFromCents(opportunity.estimatedAnnualValueCents)}</b>
        <small>est. annual value</small>
      </span>
    </button>
  );
}

function TerritoryMap({
  selectedId,
  opportunities,
}: {
  selectedId: number;
  opportunities: CommercialOpportunity[];
}) {
  return (
    <div
      className="tp-map"
      role="img"
      aria-label="Preview map showing ranked commercial laundry opportunities near the entered store"
    >
      <div className="tp-map-grid" aria-hidden="true" />
      <span className="tp-road tp-road-one" aria-hidden="true" />
      <span className="tp-road tp-road-two" aria-hidden="true" />
      <span className="tp-road tp-road-three" aria-hidden="true" />
      <span className="tp-store-pin" aria-hidden="true">
        <span>YOUR STORE</span>
        <MapPin />
      </span>
      {opportunities.slice(0, 4).map((opportunity, index) => (
        <span
          key={opportunity.id}
          className={`tp-map-pin tp-map-pin-${index + 1}${
            selectedId === opportunity.id ? " is-active" : ""
          }`}
          aria-hidden="true"
        >
          <i>{opportunity.score}</i>
          <b>{opportunity.accountName}</b>
        </span>
      ))}
      <span className="tp-map-note">Preview account data</span>
    </div>
  );
}

function MissionPreview({
  mission,
  onBack,
}: {
  mission: CommercialMission;
  onBack: () => void;
}) {
  const annualValue = formatCurrencyFromCents(
    mission.estimatedAnnualValueCents
  );

  function stagePhoneMission() {
    window.localStorage.setItem(
      COMMERCIAL_MISSION_DEMO_STORAGE_KEY,
      JSON.stringify({ ...mission, status: "phone_ready" })
    );
  }

  return (
    <section className="tp-mission" aria-labelledby="tp-mission-title">
      <button className="tp-back" type="button" onClick={onBack}>
        <ArrowLeft /> Back to territory
      </button>

      <div className="tp-mission-header">
        <span className="tp-kicker">TODAY’S BEST OPPORTUNITY</span>
        <h1 id="tp-mission-title">{mission.code}</h1>
        <p>
          The same account now continues through DayForge, BORESLAY, and the
          phone field mission.
        </p>
      </div>

      <div className="tp-continuity" aria-label="Mission continuity preview">
        <article>
          <span className="tp-stage-icon"><Sparkles /></span>
          <small>DAYFORGE RADAR</small>
          <b>{mission.accountName}</b>
          <em>{annualValue} estimated annual value</em>
          <p>{mission.primarySignal}</p>
        </article>
        <ArrowRight className="tp-continuity-arrow" aria-hidden="true" />
        <article className="is-game">
          <span className="tp-stage-icon"><Gamepad2 /></span>
          <small>BORESLAY</small>
          <b>{mission.code}</b>
          <em>{mission.accountName}</em>
          <p>Beat the hesitation. Unlock the real-world visit.</p>
        </article>
        <ArrowRight className="tp-continuity-arrow" aria-hidden="true" />
        <article>
          <span className="tp-stage-icon"><Smartphone /></span>
          <small>DAYFORGE FIELD</small>
          <b>{mission.accountName}</b>
          <em>
            Ask for {mission.decisionMaker.name ?? "the operations manager"}
          </em>
          <p>{mission.salesAngle}</p>
        </article>
      </div>

      <div className="tp-mission-grid">
        <article className="tp-mission-panel">
          <span className="tp-panel-label">WHY THIS ACCOUNT</span>
          <ul>
            {mission.reasons.map(reason => (
              <li key={reason}><CheckCircle2 /> {reason}</li>
            ))}
          </ul>
        </article>
        <article className="tp-mission-panel">
          <span className="tp-panel-label">OPENING LINE</span>
          <blockquote>“{mission.openingLine}”</blockquote>
          <span className="tp-panel-label">BEST ANGLE</span>
          <p>{mission.salesAngle}</p>
        </article>
      </div>

      <div className="tp-mission-actions">
        <a
          className="tp-primary"
          href={`/driver/sales-mission/${mission.id}`}
          onClick={stagePhoneMission}
        >
          Open the phone mission <Smartphone />
        </a>
        <a
          className="tp-back"
          href={SCHEDULER_URL ?? "mailto:adam@bldg.chat?subject=Map%20my%20territory"}
          target={SCHEDULER_URL ? "_blank" : undefined}
          rel={SCHEDULER_URL ? "noreferrer" : undefined}
        >
          Save this territory and map mine <ArrowRight />
        </a>
        <p>
          The visitor now experiences the complete handoff before scheduling:
          territory → opportunity → mission → phone.
        </p>
      </div>
    </section>
  );
}

export default function TerritoryPreview() {
  const [phase, setPhase] = useState<PreviewPhase>("entry");
  const [address, setAddress] = useState("");
  const [submittedAddress, setSubmittedAddress] = useState("");
  const [selectedId, setSelectedId] = useState(DEMO_OPPORTUNITIES[0].id);

  const previewQuery = trpc.system.commercialMission.previewTerritory.useQuery(
    { address: submittedAddress || "preview" },
    {
      enabled: submittedAddress.length >= 3,
      retry: false,
      staleTime: 5 * 60 * 1000,
    }
  );

  const opportunities =
    (previewQuery.data?.opportunities as CommercialOpportunity[] | undefined) ??
    DEMO_OPPORTUNITIES;

  useEffect(() => {
    if (!previewQuery.data || phase !== "scanning") return;
    setSelectedId(previewQuery.data.opportunities[0]?.id ?? DEMO_OPPORTUNITIES[0].id);
    setPhase("results");
  }, [phase, previewQuery.data]);

  const selectedOpportunity = useMemo(
    () =>
      opportunities.find(opportunity => opportunity.id === selectedId) ??
      opportunities[0],
    [opportunities, selectedId]
  );

  const mission = useMemo(
    () => buildCommercialMissionFromOpportunity(selectedOpportunity),
    [selectedOpportunity]
  );

  const submitAddress = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clean = address.trim();
    if (!clean) return;
    setSubmittedAddress(clean);
    setPhase("scanning");
  };

  if (phase === "mission") {
    return (
      <main className="tp-root">
        <MissionPreview mission={mission} onBack={() => setPhase("results")} />
      </main>
    );
  }

  return (
    <main className="tp-root">
      <header className="tp-nav">
        <a href="/landingfinal" className="tp-brand" aria-label="DayForge landing page">
          <span>D</span> DAYFORGE
        </a>
        <span className="tp-preview-chip">TERRITORY PREVIEW</span>
      </header>

      <section className="tp-shell">
        <div className="tp-intro">
          <span className="tp-kicker">FOR LAUNDROMAT &amp; FLUFF-AND-FOLD OWNERS</span>
          <h1>See the commercial laundry accounts around your store.</h1>
          <p>
            Enter a store address. DayForge ranks nearby hotels, property
            managers, gyms, salons, and other recurring laundry buyers—then
            turns the strongest account into one continuous mission.
          </p>
        </div>

        <form className="tp-address" onSubmit={submitAddress}>
          <label htmlFor="territory-address">Store address or business name</label>
          <div>
            <MapPin aria-hidden="true" />
            <input
              id="territory-address"
              value={address}
              onChange={event => setAddress(event.target.value)}
              placeholder="922 N Alvarado St, Los Angeles"
              autoComplete="street-address"
            />
            <button type="submit" disabled={!address.trim() || phase === "scanning"}>
              {phase === "scanning" ? <Clock3 className="is-spinning" /> : <Search />}
              {phase === "scanning" ? "Scanning" : "Map my territory"}
            </button>
          </div>
          <small>
            <ShieldCheck /> Preview mode. No business is contacted and nothing is sent.
          </small>
        </form>

        {phase === "entry" ? (
          <div className="tp-empty-state">
            <Navigation />
            <h2>Your territory starts with your store.</h2>
            <p>
              DayForge will geocode the address, discover nearby commercial
              laundry buyers, score them against routes and capacity, and show
              why each account is—or is not—worth the gas.
            </p>
          </div>
        ) : null}

        {phase === "scanning" ? (
          <div className="tp-scanning" aria-live="polite">
            <div className="tp-radar" aria-hidden="true"><i /></div>
            <h2>Scanning the streets around {submittedAddress}</h2>
            <p>Checking account type, likely laundry demand, route fit, and estimated value.</p>
            {previewQuery.error ? (
              <button type="button" className="tp-back" onClick={() => previewQuery.refetch()}>
                Retry territory scan
              </button>
            ) : null}
          </div>
        ) : null}

        {phase === "results" ? (
          <div className="tp-results">
            <div className="tp-results-head">
              <div>
                <span className="tp-kicker">PREVIEW TERRITORY</span>
                <h2>{opportunities.length} accounts worth examining first.</h2>
                <p>
                  Demo-ranked around <b>{submittedAddress}</b>. Select an account
                  to see why it fits.
                </p>
              </div>
              <button type="button" className="tp-reset" onClick={() => {
                setSubmittedAddress("");
                setPhase("entry");
              }}>
                Change address
              </button>
            </div>

            <div className="tp-results-layout">
              <div className="tp-opportunity-list">
                {opportunities.map(opportunity => (
                  <OpportunityCard
                    key={opportunity.id}
                    opportunity={opportunity}
                    active={opportunity.id === selectedId}
                    onSelect={() => setSelectedId(opportunity.id)}
                  />
                ))}
              </div>
              <TerritoryMap
                selectedId={selectedId}
                opportunities={opportunities}
              />
            </div>

            <aside className="tp-selected">
              <div>
                <span className="tp-kicker">BEST NEXT MOVE</span>
                <h2>{selectedOpportunity.accountName}</h2>
                <p>{selectedOpportunity.reasons.join(" · ")}</p>
              </div>
              <div className="tp-selected-value">
                <strong>
                  {formatCurrencyFromCents(
                    selectedOpportunity.estimatedAnnualValueCents
                  )}
                </strong>
                <small>estimated annual value</small>
              </div>
              <button className="tp-primary" type="button" onClick={() => setPhase("mission")}>
                Turn this into a mission <ArrowRight />
              </button>
            </aside>
          </div>
        ) : null}
      </section>
    </main>
  );
}
