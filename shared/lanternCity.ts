export type LanternState = "active" | "dimming" | "dark";
export type CadenceConfidence = "measured" | "sparse";

export type CustomerCadence = {
  state: LanternState;
  confidence: CadenceConfidence;
  expectedCadenceDays: number | null;
  daysSinceLastOrder: number;
  expectedNextOrder: string | null;
  cyclesMissed: number | null;
};

const DAY_MS = 86_400_000;

function dayNumber(ymd: string): number {
  const [year, month, day] = ymd.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function ymdFromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function inferCustomerCadence(input: {
  qualifyingOrderDates: string[];
  today: string;
  sparseFallback: LanternState;
}): CustomerCadence {
  const days = Array.from(
    new Set(input.qualifyingOrderDates.map(dayNumber))
  ).sort((a, b) => a - b);
  const today = dayNumber(input.today);
  const last = days.at(-1);
  const daysSinceLastOrder = last == null ? 0 : Math.max(0, today - last);
  if (days.length < 3 || last == null) {
    return {
      state: input.sparseFallback,
      confidence: "sparse",
      expectedCadenceDays: null,
      daysSinceLastOrder,
      expectedNextOrder: null,
      cyclesMissed: null,
    };
  }
  const intervals = days
    .slice(1)
    .map((day, index) => day - days[index]!)
    .filter(value => value > 0);
  if (intervals.length < 2) {
    return {
      state: input.sparseFallback,
      confidence: "sparse",
      expectedCadenceDays: null,
      daysSinceLastOrder,
      expectedNextOrder: null,
      cyclesMissed: null,
    };
  }
  const expectedCadenceDays = median(intervals.slice(-6));
  const ratio = daysSinceLastOrder / expectedCadenceDays;
  const state: LanternState =
    ratio <= 1.25 ? "active" : ratio <= 2.5 ? "dimming" : "dark";
  return {
    state,
    confidence: "measured",
    expectedCadenceDays,
    daysSinceLastOrder,
    expectedNextOrder: ymdFromDay(last + Math.round(expectedCadenceDays)),
    cyclesMissed: Math.max(0, Math.round((ratio - 1) * 10) / 10),
  };
}

export type AtlasPoint = { x: number; y: number };
export type GeoPoint = { latitude: number; longitude: number };

export const GOLDLINE_LA_VIEWPORT = {
  west: -118.445,
  east: -118.225,
  south: 34.02,
  north: 34.135,
} as const;

export const GOLDLINE_LA_LANDMARKS = [
  {
    name: "Century City",
    latitude: 34.0537,
    longitude: -118.4134,
  },
  {
    name: "Beverly Hills",
    latitude: 34.0736,
    longitude: -118.4004,
  },
  {
    name: "West Hollywood",
    latitude: 34.09,
    longitude: -118.3617,
  },
  { name: "Hollywood", latitude: 34.0928, longitude: -118.3287 },
  { name: "Koreatown", latitude: 34.0578, longitude: -118.3009 },
  { name: "Los Feliz", latitude: 34.1182, longitude: -118.2865 },
  {
    name: "Silver Lake",
    latitude: 34.0869,
    longitude: -118.2702,
  },
  { name: "Echo Park", latitude: 34.0782, longitude: -118.2606 },
  { name: "Downtown", latitude: 34.0505, longitude: -118.2479 },
] as const;

function mercatorY(latitude: number): number {
  const radians = latitude * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

export function projectLatLngToLanternAtlas(
  point: GeoPoint
): AtlasPoint & { outOfBounds: boolean } {
  const rawX = (point.longitude - GOLDLINE_LA_VIEWPORT.west) / (GOLDLINE_LA_VIEWPORT.east - GOLDLINE_LA_VIEWPORT.west) * 100;
  const northY = mercatorY(GOLDLINE_LA_VIEWPORT.north);
  const southY = mercatorY(GOLDLINE_LA_VIEWPORT.south);
  const rawY = (northY - mercatorY(point.latitude)) / (northY - southY) * 100;
  return {
    x: rawX,
    y: rawY,
    outOfBounds: rawX < 0 || rawX > 100 || rawY < 0 || rawY > 100,
  };
}
