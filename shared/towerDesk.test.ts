import { describe, expect, it } from "vitest";
import { buildTowerDesk, isTowerAddress, residentsAsOf, type DeskResidentInput } from "./towerDesk";

const now = new Date("2026-10-27T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const residents: DeskResidentInput[] = [
  { key: "a", name: "Ada Park", unit: "1507", orderedAt: [daysAgo(200), daysAgo(5)], identityKeys: ["phone:1"] },
  { key: "b", name: "Bo Lee", unit: "302", orderedAt: [daysAgo(160), daysAgo(100)], identityKeys: ["phone:2"] },
];

describe("buildTowerDesk", () => {
  it("never turns an unreadable ledger into $0", () => {
    const desk = buildTowerDesk({ buildingId: "century_park_east", now, residents, ledger: { status: "unavailable" }, referrals: { status: "unavailable" } });
    expect(desk.revenue.last30Cents).toBeNull();
    expect(desk.revenue.perHomeMonthlyCents).toBeNull();
    expect(desk.dim.estMonthlyCents).toBeNull();
    expect(desk.dim.quietResidents).toBe(1);
    expect(desk.goalMonthlyCents).toBe(80_000);
  });

  it("counts only this building's residents' paid orders in the last 30 days", () => {
    const desk = buildTowerDesk({
      buildingId: "century_park_east",
      now,
      residents,
      ledger: {
        status: "ok",
        startUtc: daysAgo(365),
        events: [
          { occurredAt: daysAgo(5), cents: 6000, identityKeys: ["phone:1"] },
          { occurredAt: daysAgo(10), cents: 9999, identityKeys: ["phone:someone-else"] },
          { occurredAt: daysAgo(100), cents: 4000, identityKeys: ["phone:2"] },
          { occurredAt: daysAgo(160), cents: 4000, identityKeys: ["phone:2"] },
        ],
      },
      referrals: { status: "unavailable" },
    });
    expect(desk.revenue).toMatchObject({ status: "ok", last30Cents: 6000, payingResidents30: 1, perHomeMonthlyCents: 6000 });
    // Bo paid $80 over the two months he was ordering
    expect(desk.dim.estMonthlyCents).toBe(4000);
  });

  it("logs our own events only, newest first, with going quiet at 45 days", () => {
    const desk = buildTowerDesk({ buildingId: "century_park_east", now, residents, ledger: { status: "unavailable" }, referrals: { status: "unavailable" } });
    expect(desk.log.map(l => `${l.unit}:${l.kind}`)).toEqual(["1507:order", "302:went_quiet", "302:order", "302:first_order", "1507:first_order"]);
    expect(desk.firstOrderDay).toBe(daysAgo(200).toISOString().slice(0, 10));
  });

  it("counts referrals that involve a resident here, by name", () => {
    const row = (from: string, to: string, orders: number) => ({ id: `${from}-${to}`, source: "cleancloud" as const, from, to, usedAt: "2026-10-01", newCustomerOrders: orders, newCustomerSpendingCents: 0, referrerReward: "pending" as const });
    const desk = buildTowerDesk({
      buildingId: "century_park_east",
      now,
      residents,
      ledger: { status: "unavailable" },
      referrals: { status: "ok", source: "cleancloud", freshness: null, rows: [row("ADA PARK", "New One", 1), row("Ada Park", "New Two", 0), row("Stranger", "Other", 3)] },
    });
    expect(desk.referrals).toMatchObject({ status: "ok", involving: 2, converted: 1, top: [{ unit: "1507", sent: 2, converted: 1 }] });
  });
});

describe("residentsAsOf", () => {
  it("lights a window from the first order and dims it after 45 quiet days", () => {
    const list = [{ key: "a", name: "A", unit: null, orderDays: ["2026-01-01", "2026-03-01"] }];
    expect(residentsAsOf(list, "2025-12-31")).toEqual([]);
    expect(residentsAsOf(list, "2026-02-20")).toEqual([{ key: "a", quiet: true }]);
    expect(residentsAsOf(list, "2026-03-10")).toEqual([{ key: "a", quiet: false }]);
  });
});

describe("OPUS LA", () => {
  it("reads both OPUS towers by street address, and nothing else", () => {
    expect(isTowerAddress("opus_la", "3545 Wilshire Blvd Apt 1607")).toBe(true);
    expect(isTowerAddress("opus_la", "3650 W 6th St #902")).toBe(true);
    expect(isTowerAddress("opus_la", "2160 Century Park East")).toBe(false);
    expect(isTowerAddress("century_park_east", "2170 Century Pk E")).toBe(true);
  });

  it("keeps the gym-towel contract in its own lane, not wired, apart from residents", () => {
    const desk = buildTowerDesk({ buildingId: "opus_la", now, residents, ledger: { status: "ok", startUtc: daysAgo(365), events: [{ occurredAt: daysAgo(3), cents: 5000, identityKeys: ["phone:1"] }] }, referrals: { status: "unavailable" } });
    expect(desk.contract).toEqual({ status: "not_wired", label: "Gym towel contract" });
    expect(desk.revenue.last30Cents).toBe(5000);
    expect(desk.goalMonthlyCents).toBeNull();
    expect(buildTowerDesk({ buildingId: "century_park_east", now, residents, ledger: { status: "unavailable" }, referrals: { status: "unavailable" } }).contract).toBeNull();
  });
});
