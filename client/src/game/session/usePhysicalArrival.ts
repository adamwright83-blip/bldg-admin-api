import { useEffect, useMemo, useRef, useState } from "react";
import {
  PhysicalArrivalTracker,
  validPhysicalArrivalTarget,
  type PhysicalArrivalSnapshot,
  type PhysicalArrivalTarget,
} from "./physicalArrival";

export type PhysicalArrivalAvailability =
  | "disabled"
  | "unsupported"
  | "permission_denied"
  | "unavailable"
  | "watching";

export type UsePhysicalArrivalResult = {
  availability: PhysicalArrivalAvailability;
  snapshot: PhysicalArrivalSnapshot | null;
};

const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 5_000,
  timeout: 15_000,
};

/**
 * Browser adapter for the pure PhysicalArrivalTracker.
 *
 * High-accuracy GPS is requested only while a real, coordinate-backed target
 * is actively relevant. Losing permission or provider availability fails
 * closed: no arrival is emitted and the rest of Goldline remains usable.
 */
export function usePhysicalArrival(input: {
  enabled: boolean;
  target: PhysicalArrivalTarget | null;
}): UsePhysicalArrivalResult {
  const { enabled, target } = input;
  const trackerRef = useRef<PhysicalArrivalTracker | null>(null);
  const [availability, setAvailability] =
    useState<PhysicalArrivalAvailability>("disabled");
  const [snapshot, setSnapshot] = useState<PhysicalArrivalSnapshot | null>(null);

  const targetKey = useMemo(
    () =>
      validPhysicalArrivalTarget(target)
        ? `${target.id}:${target.lat.toFixed(6)}:${target.lng.toFixed(6)}`
        : null,
    [target]
  );

  useEffect(() => {
    if (!enabled || !targetKey || !validPhysicalArrivalTarget(target)) {
      trackerRef.current = null;
      setSnapshot(null);
      setAvailability("disabled");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      trackerRef.current = null;
      setSnapshot(null);
      setAvailability("unsupported");
      return;
    }

    const tracker = new PhysicalArrivalTracker(target);
    trackerRef.current = tracker;
    setSnapshot(tracker.getSnapshot());
    setAvailability("watching");

    const watchId = navigator.geolocation.watchPosition(
      position => {
        if (trackerRef.current !== tracker) return;
        const next = tracker.ingest({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          timestampMs: position.timestamp,
        });
        setSnapshot(next);
        setAvailability("watching");
      },
      error => {
        if (trackerRef.current !== tracker) return;
        setSnapshot(null);
        if (error.code === error.PERMISSION_DENIED) {
          setAvailability("permission_denied");
        } else {
          setAvailability("unavailable");
        }
      },
      WATCH_OPTIONS
    );

    return () => {
      trackerRef.current = null;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled, targetKey]);

  return { availability, snapshot };
}
