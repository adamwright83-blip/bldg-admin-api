import { useMemo, useState } from "react";
import { ArrowRight, MapPinOff, RefreshCw, Search, X } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { WorldGeographySurface } from "./WorldGeographySurface";
import type { GeographicEntity } from "./GoogleMapsRealityLayer";
import { WorldDayPhaseIndicator } from "./WorldDayPhase";
import { clusterGeographicCustomers, clustersAsGoogleEntities } from "./customerGeography";
import type { CustomerLocationCluster } from "./customerGeography";
import { CustomerClusterDetail } from "./CustomerClusterDetail";

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
  const [selectedCluster, setSelectedCluster] = useState<CustomerLocationCluster | null>(null);
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

  const [googleVisible, setGoogleVisible] = useState(false);
  const customerClusters = useMemo(() => clusterGeographicCustomers(visibleCustomers as any), [visibleCustomers]);

  /**
   * The same visible records, addressed by the real coordinate the atlas
   * projection was derived from. Only records with a successful geocode carry
   * a location at all, so nothing here is estimated or back-filled.
   */
  const googleEntities: GeographicEntity[] = useMemo(
    () => [
      ...clustersAsGoogleEntities(customerClusters, cluster => {
        setSelectedPursuit(null);
        setSelectedCluster(cluster);
      }),
      ...visiblePursuits.map(item => ({
        id: `pursued:${item.pipelineId}`,
        latitude: item.location!.latitude,
        longitude: item.location!.longitude,
        label: item.name,
        kind: "pursued" as const,
        onSelect: () => {
          setSelectedCluster(null);
          setSelectedPursuit(item);
        },
      })),
    ],
    [customerClusters, visiblePursuits]
  );

  const counts = customers.reduce(
    (acc, customer) => ({
      ...acc,
      [customer.cadence.state]: acc[customer.cadence.state] + 1,
    }),
    { active: 0, dimming: 0, dark: 0 }
  );

  const unmappedCustomers = customers.filter(customer => !customer.location).length;
  const unmappedPursuits = pursued.filter(item => !item.location).length;

  return (
    <main className="lc-page">
      <header className="lc-page-header">
        <div>
          <span className="lc-spark">✦</span>
          <h1>Lantern City Atlas — Los Angeles</h1>
          <p>Real customer geography · {data?.businessDate ?? "Today"}</p>
        </div>
        <div className="lc-header-controls">
          <WorldDayPhaseIndicator />
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
        </div>
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
        <WorldGeographySurface
          mode="lantern_atlas"
          onNavigate={onNavigate}
          showNeighborhoods={true}
          showOpportunityLayer={true}
          onGoogleVisibilityChange={setGoogleVisible}
          geographicEntities={googleEntities}
        >
          {/*
            Lanterns and pursuit flames are positioned with the atlas x/y
            percentages that `projectLatLngToLanternAtlas()` produced for the
            illustrated map. Those percentages describe a spot on the painting,
            not a place, so they are not drawn over real geography — the same
            records are handed to the renderer as coordinates instead. Each
            record already carries the latitude/longitude the atlas projection
            was derived from, so nothing is estimated to do this.
          */}
          {!googleVisible && customerClusters.filter(cluster => !cluster.outsideAtlas).map(cluster => (
            <button
              type="button"
              key={cluster.key}
              className={`lc-lantern state-${cluster.dark === cluster.total ? "dark" : cluster.dimming > 0 || cluster.dark > 0 ? "dimming" : "active"}`}
              style={{
                left: `${cluster.x}%`,
                top: `${cluster.y}%`,
              }}
              onClick={() => {
                setSelectedPursuit(null);
                setSelectedCluster(cluster);
              }}
              aria-label={`${cluster.total} customer${cluster.total === 1 ? "" : "s"} at this location`}
            >
              <span className="lc-lantern-handle" />
              <span className="lc-lantern-body" />
              <span className="lc-lantern-base" />
              {cluster.total > 1 ? <b>{cluster.total}</b> : null}
            </button>
          ))}

          {!googleVisible && visiblePursuits.map(item => (
            <button
              type="button"
              key={item.pipelineId}
              className="lc-pursued-flame"
              style={{
                left: `${item.location!.x}%`,
                top: `${item.location!.y}%`,
              }}
              onClick={() => {
                setSelectedCluster(null);
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
        </WorldGeographySurface>
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

      {selectedCluster ? <CustomerClusterDetail cluster={selectedCluster} onClose={() => setSelectedCluster(null)} onOpenCustomer={onOpenCustomer} /> : null}

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
