/**
 * GOLDLINE SANDBOX — deterministic fixtures for forcing rare world states.
 *
 * Permanent development infrastructure, not a throwaway test hack. As Tower Wars
 * grows you repeatedly need five attacks, a critical facade, two hundred settled
 * scars, a zero day, a tie, or a lead reversal — none of which reality will produce
 * on demand.
 *
 * THE ABSOLUTE RULE
 *
 * Nothing here writes. These are in-memory `TowerWarsBusinessEvent` values fed
 * through the SAME production compiler (`compileTowerWarsState`) and the SAME
 * settlement (`settleTowerWars`) that live data uses. There is deliberately no
 * database access in this module, no tenant, and no persistence path — so a sandbox
 * scenario cannot touch orders, cleancloud_paid_orders, customers, revenue,
 * promises, canonical building state, settlement history or the chronicle.
 *
 * Every synthetic id is namespaced `sandbox:` so it can never collide with a real
 * economic event key, and every identity is unmistakably fake.
 */
import type { TowerWarsBusinessEvent, TowerWarsBuildingId } from "./towerWars";

export const SANDBOX_SCENARIOS = [
  "THREE_ORDER_BATTLE",
  "ZERO_DAY",
  "HISTORY_SCARS",
  "HISTORY_STRESS",
  "OPUS_SINGLE_STRIKE",
  "CPE_SINGLE_STRIKE",
  "LEAD_FLIP",
  "ACTION_ELIGIBILITY",
  "CREATURE_MATRIX",
  "TRANSITION_MATRIX",
  "REAL_DAY_REPLAY",
  "API_DEGRADATION",
] as const;
export type SandboxScenario = (typeof SANDBOX_SCENARIOS)[number];

/** Namespaced so a fixture can never be mistaken for a real economic event. */
export const SANDBOX_PREFIX = "sandbox:";

const NAMES: Record<TowerWarsBuildingId, string> = {
  opus_la: "OPUS LA",
  century_park_east: "Century Park East",
};

/** Unmistakably fake. Never a real customer. */
const SANDBOX_CUSTOMERS = ["Sandbox Ava", "Sandbox Miguel", "Sandbox Jordan"];

function event(input: {
  n: number;
  businessDate: string;
  buildingId: TowerWarsBuildingId;
  cents: number;
  hour?: number;
}): TowerWarsBusinessEvent {
  const who = SANDBOX_CUSTOMERS[(input.n - 1) % SANDBOX_CUSTOMERS.length]!;
  // Fixture ids intentionally grow into the hundreds. Keep the clock independent
  // from that identity so every synthetic event remains a valid ISO instant.
  const hour = input.hour ?? 9 + ((input.n - 1) % 8);
  return {
    eventId: `${SANDBOX_PREFIX}order:${input.n}`,
    occurredAt: `${input.businessDate}T${String(hour).padStart(2, "0")}:00:00.000Z`,
    businessDate: input.businessDate,
    buildingId: input.buildingId,
    buildingDisplayName: NAMES[input.buildingId],
    orderId: `${SANDBOX_PREFIX}order:${input.n}`,
    customerIdentity: `${SANDBOX_PREFIX}customer:${input.n}`,
    customerDisplayName: who,
    customerPhone: null,
    revenueSource: "stripe",
    realOrderValueCents: input.cents,
    sourceEvidence: {
      economicEventKey: `${SANDBOX_PREFIX}order:${input.n}`,
      sandbox: true,
    },
  };
}

export type SandboxFixture = {
  scenario: SandboxScenario;
  description: string;
  todayBusinessDate: string;
  events: TowerWarsBusinessEvent[];
};

const TODAY = "2026-08-30";

function priorDays(
  count: number,
  perDay: (day: number) => Array<{ buildingId: TowerWarsBuildingId; cents: number }>,
  startN = 100
): TowerWarsBusinessEvent[] {
  const out: TowerWarsBusinessEvent[] = [];
  let n = startN;
  for (let d = count; d >= 1; d -= 1) {
    const date = new Date(Date.parse(`${TODAY}T00:00:00Z`) - d * 86_400_000)
      .toISOString()
      .slice(0, 10);
    for (const spec of perDay(d)) {
      out.push({ ...event({ n: (n += 1), businessDate: date, ...spec }) });
    }
  }
  return out;
}

export function sandboxFixture(scenario: SandboxScenario): SandboxFixture {
  switch (scenario) {
    /**
     * The primary battle. Three synthetic orders exercise both weapons, a lead
     * change, multi-strike from one order, remainder logic, replay and contributors:
     *
     *   OPUS $60  -> charges 6000, fires once, $10 left
     *   CPE  $125 -> fires twice, $25 left, and takes the lead
     *   OPUS $100 -> $10 + $100 fires twice more, $10 left, retaking the lead
     *
     * Final: OPUS $160 / 3 fired / $10 charged. CPE $125 / 2 fired / $25 charged.
     * Therefore OPUS absorbs 2 incoming and CPE absorbs 3.
     */
    case "THREE_ORDER_BATTLE":
      return {
        scenario,
        description:
          "OPUS $60, CPE $125, OPUS $100 — both weapons, a lead reversal, and one order that fires twice.",
        todayBusinessDate: TODAY,
        events: [
          event({ n: 1, businessDate: TODAY, buildingId: "opus_la", cents: 6000 }),
          event({ n: 2, businessDate: TODAY, buildingId: "century_park_east", cents: 12500 }),
          event({ n: 3, businessDate: TODAY, buildingId: "opus_la", cents: 10000 }),
        ],
      };

    /** A legitimate $0 vs $0 arena. Not an error, not a "waiting for truth" state. */
    case "ZERO_DAY":
      return {
        scenario,
        description: "No qualifying orders. A real, calm $0 arena.",
        todayBusinessDate: TODAY,
        events: [],
      };

    /** Enough settled days to show permanent repairs across the facades. */
    case "HISTORY_SCARS":
      return {
        scenario,
        description: "Several settled days, so both facades carry visible repairs.",
        todayBusinessDate: TODAY,
        events: priorDays(6, d => [
          { buildingId: "opus_la", cents: d % 2 ? 5000 : 10000 },
          { buildingId: "century_park_east", cents: d % 3 ? 5000 : 15000 },
        ]),
      };

    /** Past the individual-scar budget, so patina compression must engage. */
    case "HISTORY_STRESS":
      return {
        scenario,
        description:
          "Far past the scar budget — older history must compress into patina without losing a strike.",
        todayBusinessDate: TODAY,
        events: priorDays(40, () => [
          { buildingId: "opus_la", cents: 20000 },
          { buildingId: "century_park_east", cents: 20000 },
        ]),
      };

    /** Weapon QA: exactly one OPUS strike, nothing else moving. */
    case "OPUS_SINGLE_STRIKE":
      return {
        scenario,
        description: "Exactly one OPUS strike. One club, one ball, tee empty in flight.",
        todayBusinessDate: TODAY,
        events: [
          event({ n: 1, businessDate: TODAY, buildingId: "opus_la", cents: 5000 }),
        ],
      };

    /** Weapon QA: exactly one CPE strike, travelling the other way. */
    case "CPE_SINGLE_STRIKE":
      return {
        scenario,
        description: "Exactly one CPE strike, travelling right to left toward OPUS.",
        todayBusinessDate: TODAY,
        events: [
          event({ n: 1, businessDate: TODAY, buildingId: "century_park_east", cents: 5000 }),
        ],
      };

    /**
     * Roles change hands twice. Buildings must not move: this is the scenario that
     * would have exposed the old role-bound geometry, where the losing building
     * held the left slot and changed height when the lead flipped.
     */
    case "LEAD_FLIP":
      return {
        scenario,
        description:
          "The lead changes hands twice. Roles move; architecture must not.",
        todayBusinessDate: TODAY,
        events: [
          event({ n: 1, businessDate: TODAY, buildingId: "opus_la", cents: 5000 }),
          event({ n: 2, businessDate: TODAY, buildingId: "century_park_east", cents: 15000 }),
          event({ n: 3, businessDate: TODAY, buildingId: "opus_la", cents: 20000 }),
        ],
      };
    case "ACTION_ELIGIBILITY":
      return { scenario, description: "Locked and eligible controls with every write disabled by sandbox policy.", todayBusinessDate: TODAY, events: [] };
    case "CREATURE_MATRIX":
      return { scenario, description: "Every psychological signal and its legitimate evidence-derived clearing route.", todayBusinessDate: TODAY, events: [] };
    case "TRANSITION_MATRIX":
      return { scenario, description: "Repeatable traversal, reverse, direct-link, mobile, and reduced-motion entry points.", todayBusinessDate: TODAY, events: [] };
    case "REAL_DAY_REPLAY":
      return { scenario, description: "A strictly read-only historical date with an isolated presentation cursor.", todayBusinessDate: TODAY, events: [] };
    case "API_DEGRADATION":
      return { scenario, description: "External geography and atmosphere failures while authored truth remains intact.", todayBusinessDate: TODAY, events: [] };
  }
}

/** Every fixture, for callers that want to enumerate the matrix. */
export function allSandboxFixtures(): SandboxFixture[] {
  return SANDBOX_SCENARIOS.map(sandboxFixture);
}

/** True when an id came from the sandbox rather than reality. */
export function isSandboxId(id: string): boolean {
  return id.startsWith(SANDBOX_PREFIX);
}
