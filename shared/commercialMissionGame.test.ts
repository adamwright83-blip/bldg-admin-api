import { describe, expect, it } from "vitest";
import {
  assertQualifyingCommercialMissionGameTelemetry,
  calculateCommercialMissionXp,
  consecutiveCompletionDays,
} from "./commercialMissionGame";

describe("commercial mission game rewards", () => {
  it("rewards victory margin and fast completion without accepting client XP", () => {
    expect(calculateCommercialMissionXp({ sparkScore: 5, clockheadScore: 2, durationMs: 90_000 })).toBe(170);
    expect(calculateCommercialMissionXp({ sparkScore: 5, clockheadScore: 4, durationMs: 300_000 })).toBe(115);
  });

  it("derives a UTC daily streak from persisted completions", () => {
    const now = new Date("2026-07-12T20:00:00.000Z");
    expect(consecutiveCompletionDays([
      new Date("2026-07-12T01:00:00.000Z"),
      new Date("2026-07-11T18:00:00.000Z"),
      new Date("2026-07-10T10:00:00.000Z"),
    ], now)).toBe(3);
  });

  it("rejects a non-winning or forged qualifying result", () => {
    expect(() => assertQualifyingCommercialMissionGameTelemetry({
      sparkScore: 4,
      clockheadScore: 2,
      durationMs: 60_000,
      replay: {},
    })).toThrow(/requires Spark to win/);
    expect(() => assertQualifyingCommercialMissionGameTelemetry({
      sparkScore: 5,
      clockheadScore: 5,
      durationMs: 60_000,
      replay: {},
    })).toThrow(/requires Spark to win/);
  });
});
