import { useEffect, useRef, useState } from "react";
import { DrivingLikelihoodTracker, type DrivingLikelihoodSnapshot } from "./drivingLikelihood";

export type DrivingAvailability = "unsupported" | "permission_denied" | "unavailable" | "watching";

export function useDrivingLikelihood(): { availability: DrivingAvailability; snapshot: DrivingLikelihoodSnapshot } {
  const trackerRef = useRef(new DrivingLikelihoodTracker());
  const [availability, setAvailability] = useState<DrivingAvailability>("unavailable");
  const [snapshot, setSnapshot] = useState(() => trackerRef.current.snapshot());
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setAvailability("unsupported");
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      position => {
        setAvailability("watching");
        setSnapshot(trackerRef.current.ingest({
          lat: position.coords.latitude, lng: position.coords.longitude,
          accuracyMeters: position.coords.accuracy, timestampMs: position.timestamp,
          speedMetersPerSecond: position.coords.speed,
        }));
      },
      error => setAvailability(error.code === error.PERMISSION_DENIED ? "permission_denied" : "unavailable"),
      { enableHighAccuracy: false, maximumAge: 10_000, timeout: 20_000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);
  return { availability, snapshot };
}
