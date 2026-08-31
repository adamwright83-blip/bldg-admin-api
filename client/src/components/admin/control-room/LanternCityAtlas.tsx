import { useMemo, useState } from "react";
import { ArrowRight, MapPinOff, RefreshCw, Search, X } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { CityTowerButton } from "./CityTowerButton";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";

const MAP_IMAGE = "/assets/admin/control-room/world/lantern-city-atlas.jpg";
const NEIGHBORHOODS = [
  { label: "West Hollywood", x: 18, y: 18 },
  { label: "Beverly Hills", x: 13, y: 43 },
  { label: "Century City", x: 12, y: 76 },
  { label: "Hollywood", x: 47, y: 34 },
  { label: "Koreatown", x: 51, y: 70 },
  { label: "Los Feliz", x: 76, y: 20 },
  { label: "Silver Lake", x: 82, y: 43 },
  { label: "Echo Park", x: 86, y: 72 },
] as const;

export {
  inferCustomerCadence,
  projectLatLngToLanternAtlas,
} from "@shared/lanternCity";
export function classifyLanternCustomer(customer: { recencyStatus: string }) {
  if (customer.recencyStatus === "lapsed") return "dark" as const;
  if (customer.recencyStatus === "cooling") return "dimming" as const;
  return "active" as const;
}

export default function LanternCityAtlas({
  onOpenCustomer,
  onNavigate,
}: {
  onOpenCustomer: (phone: string) => void;
  onNavigate: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<
    NonNullable<ReturnType<typeof useAtlasData>>["customers"][number] | null
  >(null);
  const [selectedPursuit, setSelectedPursuit] = useState<
    NonNullable<ReturnType<typeof useAtlasData>>["pursued"][number] | null
  >(null);
  const atlas = trpc.system.geographicTruth.atlas.useQuery(undefined, {
    staleTime: 30_000,
  });
  const geocode = trpc.system.geographicTruth.geocodePending.useMutation({
    onSuccess: () => atlas.refetch(),
  });
  const data = atlas.data;
  const normalized = query.trim().toLowerCase();
  const customers = data?.customers ?? [];
  const pursued = data?.pursued ?? [];
  const visibleCustomers = useMemo(
    () =>
      customers.filter(
        customer =>
          customer.location &&
          (!normalized ||
            `${customer.displayName} ${customer.address} ${customer.location.canonicalAddress ?? ""}`
              .toLowerCase()
              .includes(normalized))
      ),
    [customers, normalized]
  );
  const visiblePursuits = useMemo(
    () =>
      pursued.filter(
        item =>
          item.location &&
          (!normalized ||
            `${item.name} ${item.address} ${item.stage}`
              .toLowerCase()
              .includes(normalized))
      ),
    [pursued, normalized]
  );
  const counts = customers.reduce(
    (acc, customer) => ({
      ...acc,
      [customer.cadence.state]: acc[customer.cadence.state] + 1,
    }),
    { active: 0, dimming: 0, dark: 0 }
  );
  const unmappedCustomers = customers.filter(
    customer => !customer.location
  ).length;
  const unmappedPursuits = pursued.filter(item => !item.location).length;

  return (
    <main className="lc-page">
      <header className="lc-page-header">
        <div>
          <span className="lc-spark">✦</span>
          <h1>Lantern City Atlas — Los Angeles</h1>
          <p>Real customer geography · {data?.businessDate ?? "Today"}</p>
        </div>
        <label className="lc-search">
          <Search aria-hidden />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search customers and opportunities…"
            aria-label="Search Lantern City"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X />
            </button>
          ) : null}
        </label>
      </header>
      <section
        className="lc-status-grid"
        aria-label="Customer relationship counts"
      >
        {(["active", "dimming", "dark"] as const).map(state => (
          <article key={state} className={`lc-status-card state-${state}`}>
            <span className="lc-status-icon" />
            <div>
              <small>{state === "dark" ? "Dormant" : state}</small>
              <strong>
                {atlas.isLoading || atlas.isError ? "—" : counts[state]}
              </strong>
              <p>Customer-specific order cadence</p>
            </div>
          </article>
        ))}
        <article className="lc-status-card state-pursued">
          <span className="lc-status-icon">♨</span>
          <div>
            <small>Pursued</small>
            <strong>
              {atlas.isLoading || atlas.isError ? "—" : pursued.length}
            </strong>
            <p>Active persisted opportunities</p>
          </div>
        </article>
      </section>
      <section className="lc-map" aria-label="Customer relationship atlas">
        <img src={MAP_IMAGE} alt="Illustrated Los Angeles relationship atlas" />
        <div className="lc-map-wash" />
        {([
          { id: "century_park_east", latitude: 34.0591, longitude: -118.4147 },
          { id: "opus_la", latitude: 34.0618, longitude: -118.3011 },
        ] as const).map(tower => {
          const point = projectLatLngToLanternAtlas(tower);
          const edgeSafe = { x: Math.min(94, Math.max(8, point.x)), y: Math.min(92, Math.max(8, point.y)) };
          return <CityTowerButton key={tower.id} buildingId={tower.id} className="lc-world-tower" style={{ left: `${edgeSafe.x}%`, top: `${edgeSafe.y}%` }} returnPath="/growth/lantern-city" onNavigate={onNavigate} subtitle="TODAY battle truth" />;
        })}
        {NEIGHBORHOODS.map(item => (
          <span
            key={item.label}
            className="lc-neighborhood"
            style={{ left: `${item.x}%`, top: `${item.y}%` }}
          >
            {item.label}
          </span>
        ))}
        {visibleCustomers.map(customer => (
          <button
            type="button"
            key={customer.identityKey}
            className={`lc-lantern state-${customer.cadence.state}`}
            style={{
              left: `${customer.location!.x}%`,
              top: `${customer.location!.y}%`,
            }}
            onClick={() => {
              setSelectedPursuit(null);
              setSelectedCustomer(customer);
            }}
            aria-label={`${customer.displayName}, ${customer.cadence.state}`}
          >
            <span className="lc-lantern-handle" />
            <span className="lc-lantern-body" />
            <span className="lc-lantern-base" />
          </button>
        ))}
        {visiblePursuits.map(item => (
          <button
            type="button"
            key={item.pipelineId}
            className="lc-pursued-flame"
            style={{
              left: `${item.location!.x}%`,
              top: `${item.location!.y}%`,
            }}
            onClick={() => {
              setSelectedCustomer(null);
              setSelectedPursuit(item);
            }}
            aria-label={`Pursued: ${item.name}`}
          >
            ♨
          </button>
        ))}
        {!atlas.isLoading &&
        visibleCustomers.length + visiblePursuits.length === 0 ? (
          <div className="lc-map-empty">
            <strong>
              {atlas.isError
                ? "Geographic truth unavailable"
                : "No geocoded records match this view"}
            </strong>
            <span>
              Records without successful provider coordinates remain outside the
              illustrated map.
            </span>
          </div>
        ) : null}
      </section>
      <section className="lc-utility-row">
        <article className="lc-legend">
          <h2>Lantern legend</h2>
          {(["active", "dimming", "dark"] as const).map(state => (
            <span key={state}>
              <i className={`lc-mini-lantern state-${state}`} />
              <strong>{state === "dark" ? "Dormant" : state}</strong>
            </span>
          ))}
          <span>
            <i className="lc-mini-flame">♨</i>
            <strong>Pursued</strong>
          </span>
        </article>
        <article className="lc-unmapped">
          <MapPinOff aria-hidden />
          <div>
            <h2>Geographic Truth</h2>
            <strong>{unmappedCustomers + unmappedPursuits}</strong>
            <p>
              {data?.provider.status === "unconfigured"
                ? "Geographic provider not configured. Credential-independent records and statuses remain operational."
                : `${unmappedCustomers} customers and ${unmappedPursuits} pursuits need location.`}
            </p>
            <small>
              {Object.entries(data?.statusCounts ?? {})
                .map(([status, value]) => `${status}: ${value}`)
                .join(" · ")}
            </small>
            <button
              type="button"
              disabled={geocode.isPending}
              onClick={() => geocode.mutate({ batchSize: 20 })}
            >
              <RefreshCw className={geocode.isPending ? "animate-spin" : ""} />
              {geocode.isPending
                ? "Geocoding bounded batch…"
                : "Geocode pending locations"}
            </button>
          </div>
        </article>
      </section>
      {selectedCustomer ? (
        <aside className="lc-detail" aria-live="polite">
          <button
            type="button"
            onClick={() => setSelectedCustomer(null)}
            aria-label="Close customer detail"
          >
            <X />
          </button>
          <span>
            {selectedCustomer.cadence.state} lantern ·{" "}
            {selectedCustomer.cadence.confidence} cadence
          </span>
          <h2>{selectedCustomer.displayName}</h2>
          <p>
            {selectedCustomer.location?.canonicalAddress ??
              selectedCustomer.address}
            {selectedCustomer.unit ? ` · Unit ${selectedCustomer.unit}` : ""}
          </p>
          <dl>
            <div>
              <dt>Normal cadence</dt>
              <dd>
                {selectedCustomer.cadence.expectedCadenceDays
                  ? `${selectedCustomer.cadence.expectedCadenceDays} days`
                  : "Sparse history"}
              </dd>
            </div>
            <div>
              <dt>Days since order</dt>
              <dd>{selectedCustomer.cadence.daysSinceLastOrder}</dd>
            </div>
            <div>
              <dt>Expected next</dt>
              <dd>
                {selectedCustomer.cadence.expectedNextOrder ?? "Unavailable"}
              </dd>
            </div>
            <div>
              <dt>Cycles missed</dt>
              <dd>{selectedCustomer.cadence.cyclesMissed ?? "Unavailable"}</dd>
            </div>
          </dl>
          <button
            type="button"
            className="lc-open-customer"
            onClick={() => onOpenCustomer(selectedCustomer.phone)}
          >
            Open customer evidence <ArrowRight />
          </button>
        </aside>
      ) : null}
      {selectedPursuit ? (
        <aside className="lc-detail" aria-live="polite">
          <button
            type="button"
            onClick={() => setSelectedPursuit(null)}
            aria-label="Close pursuit detail"
          >
            <X />
          </button>
          <span>Persisted commercial pursuit</span>
          <h2>{selectedPursuit.name}</h2>
          <p>
            {selectedPursuit.location?.canonicalAddress ??
              selectedPursuit.address}
          </p>
          <dl>
            <div>
              <dt>Pipeline stage</dt>
              <dd>{selectedPursuit.stage.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>Commercial Pipeline</dd>
            </div>
            <div>
              <dt>Last activity</dt>
              <dd>
                {new Date(selectedPursuit.updatedAt).toLocaleDateString()}
              </dd>
            </div>
          </dl>
          {/* Client-side so the selected pursuit's identity survives the move.
              This was a raw <a href>, which forced a full document load and threw
              away in-memory state along with it. */}
          <Link
            className="lc-open-customer"
            href={`/commercial-pipeline?pipeline=${selectedPursuit.pipelineId}`}
          >
            Open Growth evidence <ArrowRight />
          </Link>
        </aside>
      ) : null}
    </main>
  );
}

function useAtlasData() {
  return trpc.system.geographicTruth.atlas.useQuery().data;
}
