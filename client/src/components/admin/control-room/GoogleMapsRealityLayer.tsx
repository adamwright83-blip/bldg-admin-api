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

export type RealityRendererType = "maps_js_3d" | "photorealistic_3d_tiles" | "authored_fallback";

export type GoogleMapsRealityLayerProps = {
  apiKey?: string | null;
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
  className = "",
  children,
}: GoogleMapsRealityLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<any>(null);
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
              if (!isMounted) return;
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
            window.setTimeout(() => { if (!isLoaded && isMounted) ready(); }, 4000);
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
        setActiveRenderer(mode === "photorealistic_3d_tiles" ? "photorealistic_3d_tiles" : "maps_js_3d");
        setIsLoaded(true);
        onRendererReady?.(mode);
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
