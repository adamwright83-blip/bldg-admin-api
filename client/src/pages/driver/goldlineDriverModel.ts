import type { Order } from "@shared/types";

export type GoldlineLocationSnapshot =
  | {
      status: "requesting";
      coordinates: null;
      accuracyMeters: null;
      reason: null;
    }
  | {
      status: "available";
      coordinates: { latitude: number; longitude: number };
      accuracyMeters: number | null;
      reason: null;
    }
  | {
      status: "unavailable";
      coordinates: null;
      accuracyMeters: null;
      reason: string;
    };

export type OpenChannelGap = {
  available: boolean;
  availableMinutes: number | null;
  nextCommitmentAt: string | null;
  label: string;
};

type GoldlineGeolocation = {
  getCurrentPosition: (
    success: (position: {
      coords: { latitude: number; longitude: number; accuracy: number };
    }) => void,
    error: (error: { message?: string }) => void,
    options?: PositionOptions
  ) => void;
};

export function canCompleteDelivery(order: Pick<Order, "paid">): boolean {
  return order.paid === true;
}

export function requestGoldlineLocation(
  geolocation: GoldlineGeolocation | null | undefined
): Promise<GoldlineLocationSnapshot> {
  if (!geolocation) {
    return Promise.resolve({
      status: "unavailable",
      coordinates: null,
      accuracyMeters: null,
      reason: "Browser location is unavailable",
    });
  }

  return new Promise(resolve => {
    geolocation.getCurrentPosition(
      position => {
        const { latitude, longitude, accuracy } = position.coords;
        const valid =
          Number.isFinite(latitude) &&
          Number.isFinite(longitude) &&
          latitude >= -90 &&
          latitude <= 90 &&
          longitude >= -180 &&
          longitude <= 180;
        if (!valid) {
          resolve({
            status: "unavailable",
            coordinates: null,
            accuracyMeters: null,
            reason: "Browser returned invalid coordinates",
          });
          return;
        }
        resolve({
          status: "available",
          coordinates: { latitude, longitude },
          accuracyMeters: Number.isFinite(accuracy)
            ? Math.round(accuracy)
            : null,
          reason: null,
        });
      },
      error =>
        resolve({
          status: "unavailable",
          coordinates: null,
          accuracyMeters: null,
          reason:
            error.message?.trim() || "Location permission was not granted",
        }),
      { enableHighAccuracy: false, timeout: 8_000, maximumAge: 300_000 }
    );
  });
}

export function nextCommitmentDate(
  value: string | null | undefined
): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function detectOpenChannelGap(input: {
  now: Date;
  selectedDate: string;
  nextCommitmentAt: string | null | undefined;
  fixedStopCount: number;
  hasMission: boolean;
  minimumGapMinutes?: number;
}): OpenChannelGap {
  const currentDate = [
    input.now.getFullYear(),
    String(input.now.getMonth() + 1).padStart(2, "0"),
    String(input.now.getDate()).padStart(2, "0"),
  ].join("-");
  if (input.selectedDate !== currentDate) {
    return {
      available: input.hasMission,
      availableMinutes: null,
      nextCommitmentAt: null,
      label: "OPEN CHANNEL",
    };
  }
  const next = nextCommitmentDate(input.nextCommitmentAt);
  const futureNext = next && next.getTime() > input.now.getTime() ? next : null;
  const availableMinutes = futureNext
    ? Math.max(
        0,
        Math.floor((futureNext.getTime() - input.now.getTime()) / 60_000)
      )
    : null;
  const threshold = input.minimumGapMinutes ?? 90;
  const openEndedGap = !futureNext && input.fixedStopCount === 0;
  const timedGap = availableMinutes != null && availableMinutes >= threshold;
  return {
    available: input.hasMission || openEndedGap || timedGap,
    availableMinutes,
    nextCommitmentAt: futureNext?.toISOString() ?? null,
    label:
      availableMinutes == null
        ? "OPEN-ENDED WINDOW"
        : `${Math.floor(availableMinutes / 60)}H ${availableMinutes % 60}M WINDOW`,
  };
}
