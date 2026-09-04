import { expect, it } from "vitest";
import { compileRivalrySeason, rivalrySeasonWindow, rivalrySides } from "./towerWarsSeasons";
import type { TowerWarsBusinessEvent } from "./towerWars";
const event = (date: string, cents: number, buildingId: TowerWarsBusinessEvent["buildingId"] = "century_park_east") => ({ eventId: `${date}:${buildingId}:${cents}`, occurredAt: `${date}T19:00:00Z`, businessDate: date, buildingId, realOrderValueCents: cents }) as TowerWarsBusinessEvent;
it("Mon 40 + Tue 10 fires once, next Monday resets charge", () => {
  const events = [event("2026-08-31", 4000), event("2026-09-01", 1000), event("2026-09-07", 1000)];
  expect(compileRivalrySeason(events, "2026-09-01").state.attacks).toHaveLength(1);
  expect(compileRivalrySeason(events, "2026-09-07").state.attacks).toHaveLength(0);
});
it("prior champion fixes sides despite current lead changes, draws retain champion", () => {
  const events = [event("2026-08-24", 10000, "opus_la")];
  expect(rivalrySides(events, "2026-09-01")).toEqual(["century_park_east", "opus_la"]);
  expect(rivalrySides([...events, event("2026-09-01", 20000)], "2026-09-01")).toEqual(["century_park_east", "opus_la"]);
  expect(rivalrySides([...events, event("2026-08-31", 1000), event("2026-08-31", 1000, "opus_la")], "2026-09-08")).toEqual(["century_park_east", "opus_la"]);
  expect(rivalrySides([event("2026-08-24", 12000)], "2026-09-01")).toEqual(["opus_la", "century_park_east"]);
});
it("civil week windows honor spring and fall DST", () => {
  const spring = rivalrySeasonWindow("2026-03-08");
  expect((spring.endExclusiveUtc.getTime() - spring.startUtc.getTime()) / 3600000).toBe(167);
  const fall = rivalrySeasonWindow("2026-11-01");
  expect((fall.endExclusiveUtc.getTime() - fall.startUtc.getTime()) / 3600000).toBe(169);
});
it("season replay is isolated and late evidence revises the projected winner", () => {
  const events = [event("2026-08-31", 4000), event("2026-09-01", 1000)];
  expect(compileRivalrySeason([...events, event("2026-08-24", 999999)], "2026-09-06")).toEqual(compileRivalrySeason(events, "2026-09-06"));
  expect(compileRivalrySeason([...events, event("2026-09-02", 6000, "opus_la")], "2026-09-06").winner).toBe("opus_la");
});
