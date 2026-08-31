import { useEffect, useRef, useState } from "react";
import { GoogleAttributionSafeZone } from "./GoogleAttributionSafeZone";

export type GeographicCameraTarget = {
  latitude: number;
  longitude: number;
  zoom?: number;
  tilt?: number;
  heading?: number;
  altitude?: number;
  range?: number;
};

/**
 * What actually drew the pixels. `maps_js_2d_fallback` exists because the
 * standard-map path is a tilted 2D google.maps.Map, not 3D — collapsing it into
 * `maps_js_3d` (or worse, `photorealistic_3d_tiles`) would let the capability
 * surface report a fidelity the user is not being shown.
 */
export type RealityRendererType =
  | "maps_js_3d"
  | "maps_js_2d_fallback"
  | "photorealistic_3d_tiles"
  | "authored_fallback";

/**
 * An entity placed by its real coordinate rather than by an atlas percentage.
 *
 * Goldline's illustrated Los Angeles is a painting, and
 * `projectLatLngToLanternAtlas()` maps real lat/lng onto that painting. Those
 * percentages are meaningful ONLY against the JPG. When Google is drawing the
 * world, the camera is somewhere specific over real geography and a percentage
 * of the viewport is not a location — pinning entities that way puts OPUS in
 * whatever patch of the real city happens to sit at 51%/70% of the frame.
 *
 * So entities handed to the reality layer travel as coordinates, and the
 * renderer places them natively.
 */
export type GeographicEntity = {
  id: string;
  latitude: number;
  longitude: number;
  label: string;
  /** Drives the marker's colour band. */
  kind: "canonical_tower" | "customer" | "pursued";
  onSelect?: () => void;
};

export type GoogleMapsRealityLayerProps = {
  apiKey?: string | null;
  /** Placed by real coordinate. Ignored unless the 3D renderer is active. */
  entities?: GeographicEntity[];
  target?: GeographicCameraTarget;
  initialTarget?: GeographicCameraTarget;
  onApproachStarted?: () => void;
  onApproachCompleted?: () => void;
  mode?: RealityRendererType;
  interactive?: boolean;
  onRendererReady?: (renderer: RealityRendererType) => void;
  onRendererError?: (error: string) => void;
  className?: string;
  children?: React.ReactNode;
};

// Global script loader cache
let mapsScriptLoadingPromise: Promise<void> | null = null;

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as any).google?.maps) return Promise.resolve();
  if (mapsScriptLoadingPromise) return mapsScriptLoadingPromise;

  mapsScriptLoadingPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", err => reject(err));
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=beta&libraries=maps3d,places,geometry`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = err => reject(new Error("Failed to load Google Maps JavaScript API"));
    document.head.appendChild(script);
  });

  return mapsScriptLoadingPromise;
}

export function GoogleMapsRealityLayer({
  apiKey,
  target = { latitude: 34.0522, longitude: -118.2437, zoom: 12, tilt: 45, heading: 0 },
  initialTarget,
  mode = "maps_js_3d",
  interactive = true,
  onRendererReady,
  onRendererError,
  onApproachStarted,
  onApproachCompleted,
  entities,
  className = "",
  children,
}: GoogleMapsRealityLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
  const readyFiredRef = useRef(false);
  const readyTimeoutRef = useRef<number | null>(null);
  const [activeRenderer, setActiveRenderer] = useState<RealityRendererType>("authored_fallback");
  const [isLoaded, setIsLoaded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) {
      setActiveRenderer("authored_fallback");
      return;
    }

    let isMounted = true;

    loadGoogleMapsScript(apiKey)
      .then(() => {
        if (!isMounted || !containerRef.current) return;
        const google = (window as any).google;
        if (!google?.maps) throw new Error("Google Maps namespace missing");

        // Try Maps 3D element if supported and requested
        if (mode === "maps_js_3d" && google.maps.maps3d?.Map3DElement) {
          try {
            const map3d = new google.maps.maps3d.Map3DElement({
              mode: "HYBRID",
              center: {
                lat: (initialTarget ?? target).latitude,
                lng: (initialTarget ?? target).longitude,
                altitude: (initialTarget ?? target).altitude ?? 450,
              },
              tilt: (initialTarget ?? target).tilt ?? 55,
              heading: (initialTarget ?? target).heading ?? 0,
              range: (initialTarget ?? target).range ?? 18000,
            });

            containerRef.current.innerHTML = "";
            containerRef.current.appendChild(map3d);
            mapInstanceRef.current = map3d;
            const ready = () => {
              // Guarded by a ref, not by `isLoaded`. The safety timeout below
              // closes over the state value captured when this effect ran, so
              // it always saw `isLoaded === false` and fired a SECOND
              // onRendererReady after gmp-initialized had already fired —
              // which reset the journey phase back to reality_ready mid-flight.
              if (!isMounted || readyFiredRef.current) return;
              readyFiredRef.current = true;
              setActiveRenderer("maps_js_3d");
              setIsLoaded(true);
              onRendererReady?.("maps_js_3d");
            };
            const failed = () => {
              if (!isMounted) return;
              setErrorMessage("Maps 3D renderer failed to initialize");
              onRendererError?.("Maps 3D renderer failed to initialize");
            };
            map3d.addEventListener?.("gmp-initialized", ready, { once: true });
            map3d.addEventListener?.("gmp-error", failed, { once: true });
            // Maps can take longer than this to initialise; ready() is
            // idempotent so a late gmp-initialized cannot double-fire.
            readyTimeoutRef.current = window.setTimeout(() => ready(), 4000);
            return;
          } catch (err) {
            console.warn("Maps 3D initialisation failed, falling back to standard 3D perspective", err);
          }
        }

        // Standard Styled Map with 3D tilt
        const styledMap = new google.maps.Map(containerRef.current, {
          center: { lat: target.latitude, lng: target.longitude },
          zoom: target.zoom ?? 13,
          tilt: target.tilt ?? 45,
          heading: target.heading ?? 0,
          mapTypeId: "hybrid",
          disableDefaultUI: !interactive,
          gestureHandling: interactive ? "auto" : "none",
          mapId: "goldline_reality_layer",
        });

        mapInstanceRef.current = styledMap;
        // This is an ordinary 2D google.maps.Map with a tilt — it is NOT
        // photorealistic 3D tiles, and it previously reported itself as such
        // whenever `mode` asked for tiles. A renderer must never claim to be a
        // renderer it is not: the fallback names itself honestly, so the report
        // and the capability surface describe what actually drew the pixels.
        readyFiredRef.current = true;
        setActiveRenderer("maps_js_2d_fallback");
        setIsLoaded(true);
        onRendererReady?.("maps_js_2d_fallback");
      })
      .catch(err => {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMessage(msg);
        setActiveRenderer("authored_fallback");
        onRendererError?.(msg);
      });

    return () => {
      isMounted = false;
      // A pending safety timeout from a torn-down flight must not fire a
      // readiness callback into the next one.
      if (readyTimeoutRef.current != null) {
        window.clearTimeout(readyTimeoutRef.current);
        readyTimeoutRef.current = null;
      }
      readyFiredRef.current = false;
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [apiKey, mode]);

  // Smooth camera update when target changes
  useEffect(() => {
    if (!mapInstanceRef.current || !isLoaded) return;
    const inst = mapInstanceRef.current;

    if (inst.flyCameraTo) {
      onApproachStarted?.();
      inst.flyCameraTo({
        endCamera: {
          center: {
            lat: target.latitude,
            lng: target.longitude,
            altitude: target.altitude ?? 450,
          },
          tilt: target.tilt ?? 55,
          heading: target.heading ?? 0,
          range: target.range ?? 1200,
        },
        durationMillis: 1800,
      });
      window.setTimeout(() => onApproachCompleted?.(), 1850);
    } else if (inst.panTo && inst.setHeading) {
      inst.panTo({ lat: target.latitude, lng: target.longitude });
      if (target.zoom != null) inst.setZoom(target.zoom);
      if (target.heading != null) inst.setHeading(target.heading);
      if (target.tilt != null) inst.setTilt(target.tilt);
    }
  }, [target.latitude, target.longitude, target.zoom, target.tilt, target.heading, target.range, isLoaded]);

  /**
   * Place entities natively, by coordinate, inside the 3D renderer.
   *
   * Only the 3D renderer is addressed. The 2D fallback and the authored
   * fallback deliberately receive no markers: a wrong-but-present pin is worse
   * than an absent one, and callers hide their own overlays whenever this layer
   * is visible, so nothing is being double-drawn.
   */
  const markersRef = useRef<any[]>([]);
  useEffect(() => {
    const google = (window as any).google;
    const map = mapInstanceRef.current;
    if (!isLoaded || !map || activeRenderer !== "maps_js_3d" || !google?.maps?.maps3d) {
      return;
    }
    let cancelled = false;
    (async () => {
      const lib = await google.maps.importLibrary("maps3d");
      if (cancelled) return;
      for (const marker of markersRef.current) marker.remove?.();
      markersRef.current = [];
      for (const entity of entities ?? []) {
        const Ctor = entity.onSelect && lib.Marker3DInteractiveElement
          ? lib.Marker3DInteractiveElement
          : lib.Marker3DElement;
        if (!Ctor) break;
        const marker = new Ctor({
          position: { lat: entity.latitude, lng: entity.longitude, altitude: 0 },
          label: entity.label,
          altitudeMode: lib.AltitudeMode?.CLAMP_TO_GROUND,
          extruded: entity.kind === "canonical_tower",
        });
        if (entity.onSelect) marker.addEventListener?.("gmp-click", entity.onSelect);
        map.appendChild(marker);
        markersRef.current.push(marker);
      }
    })();
    return () => {
      cancelled = true;
      for (const marker of markersRef.current) marker.remove?.();
      markersRef.current = [];
    };
  }, [entities, isLoaded, activeRenderer]);

  return (
    <div className={`cr-maps-reality-wrapper ${className}`}>
      <div ref={containerRef} className="cr-maps-viewport" />
      {children}
      <GoogleAttributionSafeZone visible={isLoaded && activeRenderer !== "authored_fallback"} />
      {errorMessage && activeRenderer === "authored_fallback" ? (
        <div className="cr-maps-fallback-notice" aria-live="polite">
          <span>Authored fallback active · Google geography recovering</span>
        </div>
      ) : null}
    </div>
  );
}
