import { describe, expect, it } from "vitest";
import { TRADE_PACKS, deviceName } from "./cpeTrade";
import { FUSE_SECONDS, HYPOTHESES, SHELLS, SHELLS_PER_NIGHT, accuracy, aimToDate, assemble, chipOutcome, defaultAim, fuseLeft, openings, shellsLeft, textIsClean, type Chip, type Record } from "./shotgunMachine";

const chloe: Record = { customerId: "c1", displayName: "Chloe Bennett", daysSinceLastOrder: 72, paidOrders: 6, lifetimeCents: 21800, lastOrderDate: "2026-08-13T08:40:00", lastOrderSummary: "wash & fold, 2 bags" };
const newish: Record = { customerId: "c2", displayName: "Ravi", daysSinceLastOrder: 50, paidOrders: 1, lifetimeCents: 3500, lastOrderDate: null, lastOrderSummary: null };

describe("the chipping shotgun", () => {
  it("opens with facts from the record only, and always has something to say", () => {
    const o = openings(chloe);
    expect(o.map(x => x.id)).toEqual(["last", "regular", "date", "value"]);
    expect(o[0].line).toContain("wash & fold, 2 bags");
    expect(openings(newish).map(x => x.id)).toEqual(["plain"]);
  });

  it("assembles the operator's text from the four choices with the brand filled in, and none of the fiction", () => {
    const text = assemble({ opening: openings(chloe)[1], hypothesis: "seasonal", shell: "free_pickup", aim: { weekday: 4, hour: 8 } }, "Laundry Farm");
    expect(text).toContain("Adam from Laundry Farm");
    expect(text).toContain("6 pickups");
    expect(text).toContain("Pickup's on me this time.");
    expect(text).toContain("Thu around 8am");
    expect(textIsClean(text)).toBe(true);
    for (const h of HYPOTHESES) for (const s of SHELLS) expect(textIsClean(assemble({ opening: openings(chloe)[0], hypothesis: h.id, shell: s.id, aim: { weekday: 1, hour: 10 } }, "Laundry Butler"))).toBe(true);
  });

  it("the text guard catches the game leaking into a message", () => {
    expect(textIsClean("Hi Chloe, the zombie chip worked")).toBe(false);
    expect(textIsClean("Hi Chloe, want a pickup Thursday?")).toBe(true);
  });

  it("aims by default at when they last ordered; a bare date aims at 10am", () => {
    expect(defaultAim(chloe)).toEqual({ weekday: 4, hour: 8 });
    expect(defaultAim({ ...chloe, lastOrderDate: "2026-08-13T00:00:00" })).toEqual({ weekday: 4, hour: 10 });
    expect(defaultAim(newish, new Date("2026-10-25T12:00:00")).hour).toBe(10);
  });

  it("an aim is always a future time on that weekday at that hour", () => {
    const now = new Date("2026-10-25T18:30:00"); // a Sunday evening
    const d = aimToDate({ weekday: 4, hour: 8 }, now);
    expect(d.getDay()).toBe(4);
    expect(d.getHours()).toBe(8);
    expect(d.getTime()).toBeGreaterThan(now.getTime());
    const sameDayEarlier = aimToDate({ weekday: 0, hour: 10 }, now);
    expect(sameDayEarlier.getTime() - now.getTime()).toBeGreaterThan(6 * 86400_000);
  });

  it("three shells a night, counted by the local date; a shot with no offer costs no shell", () => {
    const night = new Date("2026-10-25T21:00:00");
    const fired = (shell: Chip["shell"], at: string): Chip => ({ customerId: "x", hypothesis: "forgot", shell, firedAt: at, aimedAt: at });
    expect(shellsLeft([], night)).toBe(SHELLS_PER_NIGHT);
    expect(shellsLeft([fired("free_pickup", "2026-10-25T20:00:00"), fired("credit_10", "2026-10-25T20:10:00"), fired("none", "2026-10-25T20:20:00")], night)).toBe(1);
    expect(shellsLeft([fired("free_pickup", "2026-10-24T20:00:00")], night)).toBe(SHELLS_PER_NIGHT);
  });

  it("a chip took when the record moved after the shot; it is open for two weeks, then missed", () => {
    const chip: Chip = { customerId: "c1", hypothesis: "forgot", shell: "none", firedAt: "2026-10-01T10:00:00", aimedAt: "2026-10-02T10:00:00" };
    expect(chipOutcome(chip, { replied: true, lastOrderDate: null }, new Date("2026-10-03"))).toBe("took");
    expect(chipOutcome(chip, { replied: false, lastOrderDate: "2026-10-05T09:00:00" }, new Date("2026-10-06"))).toBe("took");
    expect(chipOutcome(chip, { replied: false, lastOrderDate: "2026-08-05T09:00:00" }, new Date("2026-10-06"))).toBe("open");
    expect(chipOutcome(chip, { replied: false, lastOrderDate: "2026-08-05T09:00:00" }, new Date("2026-10-20"))).toBe("missed");
    expect(accuracy([chip, chip, chip], ["took", "missed", "open"])).toEqual({ took: 1, missed: 1, open: 1 });
  });

  it("the fuse is thirty seconds from the taze", () => {
    expect(fuseLeft(1000, 1000)).toBe(FUSE_SECONDS);
    expect(fuseLeft(1000, 1000 + 12_000)).toBe(FUSE_SECONDS - 12);
    expect(fuseLeft(1000, 1000 + 60_000)).toBe(0);
  });

  it("every trade pack names a room, four devices and the lines the game needs", () => {
    for (const pack of Object.values(TRADE_PACKS)) {
      expect(pack.devices).toHaveLength(4);
      expect(pack.room.floor).toBe(1);
      expect(pack.lines.roomDone("Laundry Farm")).toContain("Laundry Farm");
      expect(pack.lines.counter(2, 4)).toMatch(/2\/4/);
      expect(deviceName(pack, 0)).toBe(`${pack.device.noun} 1`);
    }
  });
});
