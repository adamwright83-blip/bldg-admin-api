import { useState } from "react";
import { ArrowUpRight, Camera, Eye, MapPin, Video, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { CanonicalBuildingArt } from "./CanonicalBuildingArt";
import type { CanonicalBuildingId } from "./buildingArt";
import { GoogleAttributionSafeZone } from "./GoogleAttributionSafeZone";
import { GoogleMapsRealityLayer } from "./GoogleMapsRealityLayer";
import { canonicalGeographyFor } from "@shared/canonicalGeography";

export function RealityWindow({
  buildingId,
  onClose,
}: {
  buildingId: CanonicalBuildingId;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"facade" | "aerial" | "place" | "3d">("facade");
  const runtime = trpc.system.google.runtimeConfig.useQuery(undefined, { staleTime: Infinity });
  const geography = canonicalGeographyFor(buildingId);
  const query = trpc.system.google.buildingReality.useQuery(
    { buildingId },
    { staleTime: 60_000 }
  );

  const data = query.data;
  const place = data?.place;
  const streetView = data?.streetView;
  const aerial = data?.aerial;

  const attributions: Array<{ text: string; uri?: string }> = [];
  if (streetView?.attributionText) {
    attributions.push({ text: streetView.attributionText });
  }
  if (place?.primaryPhotoAttribution) {
    attributions.push({
      text: place.primaryPhotoAttribution.displayName,
      uri: place.primaryPhotoAttribution.uri,
    });
  }

  return (
    <aside className="cr-reality-window" aria-label="Grounded Real Place Window" aria-live="polite">
      <header className="cr-reality-header">
        <div>
          <span className="cr-reality-tag">
            <MapPin className="h-3 w-3" /> Real Los Angeles Identity
          </span>
          <h2>{place?.displayName ?? (buildingId === "opus_la" ? "OPUS LA" : "Century Park East")}</h2>
          <p>{place?.formattedAddress ?? (buildingId === "opus_la" ? "3545 Wilshire Blvd, Los Angeles, CA" : "2170 Century Park E, Los Angeles, CA")}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close reality window">
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Tabs */}
      <nav className="cr-reality-tabs">
        <button type="button" className={activeTab === "3d" ? "is-active" : ""} onClick={() => setActiveTab("3d")}>3D Spyglass</button>
        <button
          type="button"
          className={activeTab === "facade" ? "is-active" : ""}
          onClick={() => setActiveTab("facade")}
        >
          <Camera className="h-3.5 w-3.5" /> Facade
        </button>
        <button
          type="button"
          className={activeTab === "aerial" ? "is-active" : ""}
          onClick={() => setActiveTab("aerial")}
        >
          <Video className="h-3.5 w-3.5" /> Aerial Orbit
        </button>
        <button
          type="button"
          className={activeTab === "place" ? "is-active" : ""}
          onClick={() => setActiveTab("place")}
        >
          <Eye className="h-3.5 w-3.5" /> Identity Seam
        </button>
      </nav>

      <div className="cr-reality-viewport">
        {activeTab === "3d" ? runtime.data?.mapsJavascriptApiKey && geography ?
          <GoogleMapsRealityLayer apiKey={runtime.data.mapsJavascriptApiKey} mode="maps_js_3d"
            target={{ latitude: geography.latitude, longitude: geography.longitude, heading: geography.facadeHeading, zoom: 16, tilt: 55 }} />
          : <p>Real 3D imagery is unavailable in this environment. The fantasy atlas does not establish real-place evidence.</p> : null}
        {activeTab === "facade" ? (
          <div className="cr-reality-facade">
            {streetView?.hasCoverage && streetView.imageUrl ? (
              <div className="cr-reality-image-frame">
                <img
                  src={streetView.imageUrl}
                  alt={`Verified facade of ${place?.displayName ?? buildingId}`}
                  className="cr-reality-photo"
                />
                <span className="cr-reality-badge">{streetView.contextLabel}</span>
              </div>
            ) : (
              <div className="cr-reality-fallback">
                <div className="cr-reality-art-preview">
                  <CanonicalBuildingArt buildingId={buildingId} />
                </div>
                <p>Street View facade recovering or unavailable for this location.</p>
                <small>Authored architecture is game fiction, not real-place imagery.</small>
              </div>
            )}
          </div>
        ) : null}

        {activeTab === "aerial" ? (
          <div className="cr-reality-aerial">
            {aerial?.status === "active" && aerial.videoUri ? (
              <div className="cr-reality-video-frame">
                <video
                  src={aerial.videoUri}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="cr-reality-video"
                />
                <span className="cr-reality-badge">Google Aerial Orbit</span>
              </div>
            ) : aerial?.status === "processing" ? (
              <div className="cr-reality-fallback">
                <strong>Aerial Orbit Processing…</strong>
                <p>Google Aerial View is generating an orbital video for this building.</p>
              </div>
            ) : (
              <div className="cr-reality-fallback">
                <div className="cr-reality-art-preview">
                  <CanonicalBuildingArt buildingId={buildingId} />
                </div>
                <p>Aerial video orbit currently unavailable for this building coordinate.</p>
                <small>Try the 3D Spyglass or inspect the recorded place identity.</small>
              </div>
            )}
          </div>
        ) : null}

        {activeTab === "place" ? (
          <div className="cr-reality-seam">
            <div className="cr-reality-seam-grid">
              <div className="cr-reality-art-preview">
                <CanonicalBuildingArt buildingId={buildingId} />
                <strong>Goldline Tower</strong>
              </div>
              <div className="cr-reality-details">
                <dl>
                  <div>
                    <dt>Canonical ID</dt>
                    <dd>{buildingId}</dd>
                  </div>
                  <div>
                    <dt>Place ID</dt>
                    <dd>{place?.id ?? "Unlinked"}</dd>
                  </div>
                  <div>
                    <dt>Primary Type</dt>
                    <dd>{place?.primaryType ?? "apartment_building"}</dd>
                  </div>
                  <div>
                    <dt>Coordinates</dt>
                    <dd>
                      {place?.location
                        ? `${place.location.latitude.toFixed(4)}, ${place.location.longitude.toFixed(4)}`
                        : "Authoritative"}
                    </dd>
                  </div>
                </dl>
                {place?.websiteUri ? (
                  <a
                    href={place.websiteUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cr-reality-link"
                  >
                    Verified building website <ArrowUpRight className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <GoogleAttributionSafeZone
        visible={true}
        providerAttributions={attributions}
        className="cr-reality-attribution"
      />
    </aside>
  );
}
