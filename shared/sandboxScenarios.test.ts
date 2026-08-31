import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  SANDBOX_SCENARIOS,
  allSandboxFixtures,
  isSandboxId,
  sandboxFixture,
} from "./sandboxScenarios";
import { settleTowerWars } from "./towerWarsSettlement";
import { compileTowerWarsState } from "./towerWars";
import { TOWER_WARS_ATTACK_THRESHOLD_CENTS } from "./goldlineGameConfig";

/** Every scenario is settled through the SAME code path production uses. */
function settle(scenario: (typeof SANDBOX_SCENARIOS)[number]) {
  const fixture = sandboxFixture(scenario);
  return settleTowerWars({
    events: fixture.events,
    todayBusinessDate: fixture.todayBusinessDate,
  });
}

describe("the sandbox cannot touch production truth", () => {
  const src = readFileSync(
    new URL("./sandboxScenarios.ts", import.meta.url),
    "utf8"
  );
  // Doc comments explain the rule, so assert against code only — a guard that
  // trips on its own explanation proves nothing.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("has no persistence path of any kind", () => {
    for (const banned of [
      "drizzle",
      "insert(",
      "update(",
      "delete(",
      "db.",
      "fetch(",
      "trpc",
      "mutation",
    ]) {
      expect(code).not.toContain(banned);
    }
  });

  it("namespaces every synthetic id so it can never collide with a real one", () => {
    for (const fixture of allSandboxFixtures()) {
      for (const event of fixture.events) {
        expect(isSandboxId(event.eventId)).toBe(true);
        expect(isSandboxId(String(event.orderId))).toBe(true);
        expect(isSandboxId(String(event.customerIdentity))).toBe(true);
      }
    }
  });

  it("labels its evidence as synthetic so nothing downstream can mistake it", () => {
    for (const event of sandboxFixture("THREE_ORDER_BATTLE").events) {
      expect(event.sourceEvidence.sandbox).toBe(true);
    }
  });

  it("gives every event a valid deterministic ISO timestamp regardless of id size", () => {
    for (const fixture of allSandboxFixtures()) {
      for (const event of fixture.events) {
        expect(Number.isFinite(Date.parse(event.occurredAt))).toBe(true);
        expect(new Date(event.occurredAt).toISOString()).toBe(event.occurredAt);
      }
    }
  });

  it("never borrows a real customer's name", () => {
    for (const fixture of allSandboxFixtures()) {
      for (const event of fixture.events) {
        expect(event.customerDisplayName).toMatch(/^Sandbox /);
        expect(event.customerPhone).toBeNull();
      }
    }
  });
});

describe("THREE_ORDER_BATTLE resolves to the specified match", () => {
  const settlement = settle("THREE_ORDER_BATTLE");
  const opus = settlement.buildings.opus_la.today;
  const cpe = settlement.buildings.century_park_east.today;

  it("books the real revenue on each side", () => {
    expect(opus.revenueCents).toBe(16000); // $60 + $100
    expect(cpe.revenueCents).toBe(12500); // $125
    expect(opus.orderCount).toBe(2);
    expect(cpe.orderCount).toBe(1);
  });

  it("fires the exact number of strikes the threshold implies", () => {
    // $60 -> 1 strike ($10 left). $10 + $100 -> 2 more strikes ($10 left).
    expect(opus.outgoingAttacks).toBe(3);
    // $125 -> 2 strikes ($25 left).
    expect(cpe.outgoingAttacks).toBe(2);
  });

  it("leaves exactly the specified charge unspent", () => {
    expect(opus.unspentValueCents).toBe(1000); // $10
    expect(cpe.unspentValueCents).toBe(2500); // $25
  });

  it("lands every strike on the other building", () => {
    expect(cpe.incomingAttacks).toBe(opus.outgoingAttacks);
    expect(opus.incomingAttacks).toBe(cpe.outgoingAttacks);
  });

  it("shows damage that follows from today's incoming count", () => {
    expect(cpe.damage).toBe("heavily-damaged"); // 3 absorbed
    expect(opus.damage).toBe("cracked"); // 2 absorbed
  });

  it("exercises one order that crosses the threshold twice", () => {
    // The $125 CPE order is a single revenue arrival producing two discharges.
    const state = compileTowerWarsState(sandboxFixture("THREE_ORDER_BATTLE").events);
    const fromOneOrder = state.attacks.filter(
      a => a.triggeringOrderId === "sandbox:order:2"
    );
    expect(fromOneOrder).toHaveLength(2);
  });
});

describe("ZERO_DAY is a real state, not an error", () => {
  const settlement = settle("ZERO_DAY");

  it("presents a calm $0 arena on both sides", () => {
    for (const id of ["opus_la", "century_park_east"] as const) {
      const today = settlement.buildings[id].today;
      expect(today.revenueCents).toBe(0);
      expect(today.outgoingAttacks).toBe(0);
      expect(today.incomingAttacks).toBe(0);
      expect(today.damage).toBe("pristine");
    }
  });
});

describe("history scenarios force states reality will not produce on demand", () => {
  it("HISTORY_SCARS settles prior days without disturbing today", () => {
    const settlement = settle("HISTORY_SCARS");
    for (const id of ["opus_la", "century_park_east"] as const) {
      const building = settlement.buildings[id];
      expect(building.strata.length).toBeGreaterThan(0);
      expect(building.settledScars).toBeGreaterThan(0);
      // Today had no orders, so today's match is clean regardless of history.
      expect(building.today.damage).toBe("pristine");
    }
  });

  it("HISTORY_STRESS goes far past any per-scar rendering budget", () => {
    const settlement = settle("HISTORY_STRESS");
    const opus = settlement.buildings.opus_la;
    expect(opus.strata).toHaveLength(40);
    // 40 days x 4 incoming — well beyond what can be drawn individually.
    expect(opus.settledScars).toBeGreaterThan(100);
  });

  it("keeps lifetime revenue whole even though daily charge expires", () => {
    const settlement = settle("HISTORY_STRESS");
    const opus = settlement.buildings.opus_la;
    expect(opus.lifetime.revenueCents).toBe(40 * 20000);
    expect(opus.today.unspentValueCents).toBe(0);
  });
});

describe("single-strike scenarios isolate one weapon", () => {
  it("OPUS fires exactly once and nothing comes back", () => {
    const s = settle("OPUS_SINGLE_STRIKE");
    expect(s.buildings.opus_la.today.outgoingAttacks).toBe(1);
    expect(s.buildings.century_park_east.today.outgoingAttacks).toBe(0);
    expect(s.buildings.century_park_east.today.incomingAttacks).toBe(1);
  });

  it("CPE fires exactly once in the other direction", () => {
    const s = settle("CPE_SINGLE_STRIKE");
    expect(s.buildings.century_park_east.today.outgoingAttacks).toBe(1);
    expect(s.buildings.opus_la.today.incomingAttacks).toBe(1);
  });

  it("spends the whole threshold, leaving no charge", () => {
    const s = settle("OPUS_SINGLE_STRIKE");
    expect(s.buildings.opus_la.today.unspentValueCents).toBe(0);
    expect(s.buildings.opus_la.today.revenueCents).toBe(
      TOWER_WARS_ATTACK_THRESHOLD_CENTS
    );
  });
});

describe("LEAD_FLIP changes roles twice", () => {
  it("ends with OPUS ahead after trailing mid-day", () => {
    const fixture = sandboxFixture("LEAD_FLIP");
    const afterTwo = compileTowerWarsState(fixture.events.slice(0, 2));
    expect(afterTwo.buildings.century_park_east.revenueCents).toBeGreaterThan(
      afterTwo.buildings.opus_la.revenueCents
    );
    const final = compileTowerWarsState(fixture.events);
    expect(final.buildings.opus_la.revenueCents).toBeGreaterThan(
      final.buildings.century_park_east.revenueCents
    );
  });
});

describe("every scenario is well-formed", () => {
  it("settles without throwing and describes itself", () => {
    for (const scenario of SANDBOX_SCENARIOS) {
      const fixture = sandboxFixture(scenario);
      expect(fixture.description.length).toBeGreaterThan(10);
      expect(() => settle(scenario)).not.toThrow();
    }
  });

  it("dates every event on or before the day it claims to describe", () => {
    for (const fixture of allSandboxFixtures()) {
      for (const event of fixture.events) {
        expect(event.businessDate <= fixture.todayBusinessDate).toBe(true);
      }
    }
  });

  it("is deterministic — the same scenario twice is byte-identical", () => {
    for (const scenario of SANDBOX_SCENARIOS) {
      expect(sandboxFixture(scenario)).toEqual(sandboxFixture(scenario));
    }
  });
});
