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

export const LANTERN_CITY_CONTROL_POINTS = [
  {
    name: "Century City",
    latitude: 34.0537,
    longitude: -118.4134,
    x: 12,
    y: 76,
  },
  {
    name: "Beverly Hills",
    latitude: 34.0736,
    longitude: -118.4004,
    x: 13,
    y: 43,
  },
  {
    name: "West Hollywood",
    latitude: 34.09,
    longitude: -118.3617,
    x: 18,
    y: 18,
  },
  { name: "Hollywood", latitude: 34.0928, longitude: -118.3287, x: 47, y: 34 },
  { name: "Koreatown", latitude: 34.0578, longitude: -118.3009, x: 51, y: 70 },
  { name: "Los Feliz", latitude: 34.1182, longitude: -118.2865, x: 76, y: 20 },
  {
    name: "Silver Lake",
    latitude: 34.0869,
    longitude: -118.2702,
    x: 82,
    y: 43,
  },
  { name: "Echo Park", latitude: 34.0782, longitude: -118.2606, x: 86, y: 72 },
] as const;

function solve3(
  matrix: number[][],
  vector: number[]
): [number, number, number] {
  const augmented = matrix.map((row, index) => [...row, vector[index]!]);
  for (let pivot = 0; pivot < 3; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < 3; row += 1)
      if (
        Math.abs(augmented[row]![pivot]!) > Math.abs(augmented[best]![pivot]!)
      )
        best = row;
    [augmented[pivot], augmented[best]] = [augmented[best]!, augmented[pivot]!];
    const scale = augmented[pivot]![pivot]!;
    for (let col = pivot; col < 4; col += 1) augmented[pivot]![col] /= scale;
    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row]![pivot]!;
      for (let col = pivot; col < 4; col += 1)
        augmented[row]![col] -= factor * augmented[pivot]![col]!;
    }
  }
  return [augmented[0]![3]!, augmented[1]![3]!, augmented[2]![3]!];
}

function fit(axis: "x" | "y"): [number, number, number] {
  let ll = 0,
    la = 0,
    l = 0,
    aa = 0,
    a = 0,
    n = 0,
    lv = 0,
    av = 0,
    v = 0;
  for (const point of LANTERN_CITY_CONTROL_POINTS) {
    const value = point[axis];
    ll += point.longitude * point.longitude;
    la += point.longitude * point.latitude;
    l += point.longitude;
    aa += point.latitude * point.latitude;
    a += point.latitude;
    n += 1;
    lv += point.longitude * value;
    av += point.latitude * value;
    v += value;
  }
  return solve3(
    [
      [ll, la, l],
      [la, aa, a],
      [l, a, n],
    ],
    [lv, av, v]
  );
}

const X_COEFFICIENTS = fit("x");
const Y_COEFFICIENTS = fit("y");

export function projectLatLngToLanternAtlas(
  point: GeoPoint
): AtlasPoint & { outOfBounds: boolean } {
  const rawX =
    X_COEFFICIENTS[0] * point.longitude +
    X_COEFFICIENTS[1] * point.latitude +
    X_COEFFICIENTS[2];
  const rawY =
    Y_COEFFICIENTS[0] * point.longitude +
    Y_COEFFICIENTS[1] * point.latitude +
    Y_COEFFICIENTS[2];
  return {
    x: Math.max(2, Math.min(98, rawX)),
    y: Math.max(5, Math.min(95, rawY)),
    outOfBounds: rawX < 2 || rawX > 98 || rawY < 5 || rawY > 95,
  };
}
