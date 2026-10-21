import { describe, expect, it, vi } from "vitest";
import {
  daphneDecisionPromptLine,
  daphneDecisionTargets,
  evaluateDaphneDecisionOutcomes,
  isDaphneDecisionPointsEnabled,
  openDaphneDecisionPoint,
  selectDaphneFraming,
  DAPHNE_DECISION_POINT_POLICY_VERSION,
  type DaphneDecisionPorts,
} from "./decisionPoints";
import { validateDaphneIntervention, type DaphneInterventionRecord, type RecordDaphneInterventionInput } from "./interventionLedger";
import type { DaphneOutcomeRecord, RecordDaphneOutcomeInput } from "./outcomeLedger";
import type { DriverDayLineCallFacts, DriverDayLineStopFact } from "../../claire/showrunner/driverDayLineCall";
import { systemPrompt, type ShowrunnerCallState } from "../../claire/showrunner/showrunnerTurn";

const ON = { DAPHNE_V2_DECISION_POINTS: "1" } as NodeJS.ProcessEnv;
const operator = { tenantId: "default", canonicalOperatorId: "tenant:default:operator:adam-admin", operatorUserId: "adam-admin" };

function stop(id: string, title: string, completion: DriverDayLineStopFact["completion"] = "unfinished", executable = true): DriverDayLineStopFact {
  return { id, title, status: completion === "unfinished" ? "ready" : "completed", timeLabel: "9:00", executable, completion, needsApproval: false, evidence: completion === "completed_with_evidence" ? "follow-up:1" : null };
}
function line(businessDate: string, stops: DriverDayLineStopFact[]): DriverDayLineCallFacts {
  return { read: "read", businessDate, stops, designatedMission: null, fieldBlockers: [], pendingApproval: [], omissions: [] };
}
const briefing = {
  businessDate: "2026-10-21",
  driverDayLine: line("2026-10-21", [stop("living-world-a", "Visit The Chadwick"), stop("living-world-b", "Visit Wilshire Vermont"), stop("x", "Done thing", "completed_with_evidence", false)]),
  tomorrow: [
    { id: "c1", title: "Call Dana", objective: null, status: "open" as const, window: null, note: null },
    { id: "c2", title: "Pitch Los Feliz Towers", objective: null, status: "open" as const, window: null, note: null },
  ],
};

function memoryPorts(overrides: Partial<DaphneDecisionPorts> = {}) {
  const interventions: DaphneInterventionRecord[] = [];
  const outcomes: DaphneOutcomeRecord[] = [];
  const observations: Array<Record<string, unknown>> = [];
  const ports: DaphneDecisionPorts = {
    loadPreferences: async () => ({}),
    loadDeclaredPlainSourceRef: async () => null,
    listInterventions: async () => interventions,
    listOutcomes: async () => outcomes,
    recordObservation: (async (input: Record<string, unknown>) => {
      observations.push(input);
      return { id: `obs_${observations.length}`, ...input };
    }) as unknown as DaphneDecisionPorts["recordObservation"],
    recordIntervention: async (input: RecordDaphneInterventionInput) => {
      validateDaphneIntervention(input);
      const existing = interventions.find(i => i.idempotencyKey === input.idempotencyKey);
      if (existing) return existing;
      const row: DaphneInterventionRecord = {
        id: `dint_${interventions.length + 1}`,
        ...input,
        selectionProbability: input.selectionProbability ?? null,
        propensity: input.propensity ?? null,
        policyReceipt: input.policyReceipt ?? null,
        interventionDefinitionVersion: input.interventionDefinitionVersion ?? null,
        proximalOutcomeWindowMinutes: input.proximalOutcomeWindowMinutes ?? null,
        createdAt: "2026-10-21T14:00:00.000Z",
      };
      interventions.push(row);
      return row;
    },
    recordOutcome: async (input: RecordDaphneOutcomeInput) => {
      const row = {
        ...input,
        id: `dout_${outcomes.length + 1}`,
        createdAt: new Date().toISOString(),
        windowStart: input.windowStart ? new Date(input.windowStart).toISOString() : null,
        windowEnd: input.windowEnd ? new Date(input.windowEnd).toISOString() : null,
        observedAt: new Date(input.observedAt).toISOString(),
      } as DaphneOutcomeRecord;
      outcomes.push(row);
      return row;
    },
    random: () => 0.5,
    ...overrides,
  };
  return { ports, interventions, outcomes, observations };
}

describe("Daphne decision points: flag", () => {
  it("is off unless DAPHNE_V2_DECISION_POINTS is explicitly on", () => {
    expect(isDaphneDecisionPointsEnabled("default", {} as NodeJS.ProcessEnv)).toBe(false);
    expect(isDaphneDecisionPointsEnabled("default", { DAPHNE_V2_DECISION_POINTS: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isDaphneDecisionPointsEnabled("default", ON)).toBe(true);
    expect(isDaphneDecisionPointsEnabled("other", { ...ON, DAPHNE_V2_DECISION_POINTS_TENANTS: "default" })).toBe(false);
  });

  it("records nothing when the flag is off", async () => {
    const m = memoryPorts();
    const decision = await openDaphneDecisionPoint({ operator, purpose: "morning_readiness", briefing, now: new Date("2026-10-21T14:00:00Z"), env: {} }, m.ports);
    expect(decision).toBeNull();
    expect(m.observations).toHaveLength(0);
    expect(m.interventions).toHaveLength(0);
  });
});

describe("Daphne decision points: targets", () => {
  it("morning frames the first open executable stop, deduplicated, with a second real item", () => {
    const t = daphneDecisionTargets("morning_first_action", briefing);
    expect(t.primary).toEqual({ id: "living-world-a", title: "Visit The Chadwick", businessDate: "2026-10-21" });
    expect(t.second?.title).toBe("Visit Wilshire Vermont");
  });
  it("evening frames tomorrow's first open item as its Day Line commitment stop", () => {
    const t = daphneDecisionTargets("evening_tomorrow_move", briefing);
    expect(t.primary).toEqual({ id: "commitment-c1", title: "Call Dana", businessDate: "2026-10-22" });
    expect(t.second?.id).toBe("commitment-c2");
  });
});

describe("Daphne decision points: selection and consent separation", () => {
  const all = ["plain_instruction", "implementation_intention", "choice_of_two"] as const;
  it("uses the standard presentation, deterministically, without experimentation consent", () => {
    const s = selectDaphneFraming({ eligible: all, consent: { adaptationAllowed: true, experimentationAllowed: false, declaredPlainSourceRef: null }, estimates: [], contextKey: "morning_first_action", random: () => 0.99 });
    expect(s).toMatchObject({ chosen: "plain_instruction", selectionMode: "deterministic", probability: 1, reason: "standard_presentation_without_experimentation_consent" });
  });
  it("honours an explicit plain preference without requiring safe_experimentation", () => {
    const s = selectDaphneFraming({ eligible: all, consent: { adaptationAllowed: true, experimentationAllowed: false, declaredPlainSourceRef: "daphne_observations:o1" }, estimates: [], contextKey: "k", random: () => 0.99 });
    expect(s.reason).toBe("explicit_plain_preference");
    expect(s.chosen).toBe("plain_instruction");
  });
  it("draws uniformly with consent and no support, and logs the probability", () => {
    const consent = { adaptationAllowed: true, experimentationAllowed: true, declaredPlainSourceRef: null };
    const picks = [0.1, 0.5, 0.9].map(r => selectDaphneFraming({ eligible: all, consent, estimates: [], contextKey: "k", random: () => r }));
    expect(picks.map(p => p.chosen)).toEqual(["plain_instruction", "implementation_intention", "choice_of_two"]);
    for (const p of picks) {
      expect(p.selectionMode).toBe("randomized");
      expect(p.probability).toBeCloseTo(1 / 3, 5);
      expect(Object.values(p.propensity).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
  });
  it("tilts toward the higher observed rate only with support, keeping a floor on every option", () => {
    const est = (actionKey: string, n: number, successRate: number) => ({ actionKey, contextKey: "k", n, successRate, epistemicStatus: "association_only" as const, expectedProximalOutcome: successRate, burdenEstimate: null, sourceClaimIds: [], meanBurden: null, sourceObservationIds: [], sourceOutcomeIds: [] });
    const consent = { adaptationAllowed: true, experimentationAllowed: true, declaredPlainSourceRef: null };
    const s = selectDaphneFraming({ eligible: all, consent, estimates: [est("plain_instruction", 6, 0.2), est("implementation_intention", 6, 0.7), est("choice_of_two", 6, 0.3)], contextKey: "k", random: () => 0.0 });
    expect(s.selectionMode).toBe("propensity");
    expect(s.propensity).toEqual({ plain_instruction: 0.2, implementation_intention: 0.6, choice_of_two: 0.2 });
    const thin = selectDaphneFraming({ eligible: all, consent, estimates: [est("plain_instruction", 6, 0.2), est("implementation_intention", 2, 1)], contextKey: "k", random: () => 0.0 });
    expect(thin.selectionMode).toBe("randomized");
  });
});

describe("Daphne decision points: recording", () => {
  it("records availability, then an intervention with propensity, policy version and a declared window", async () => {
    const m = memoryPorts({
      loadPreferences: async () => ({ safe_experimentation: { status: "active", value: true } as never }),
      random: () => 0.5,
    });
    const now = new Date("2026-10-21T14:00:00Z");
    const decision = await openDaphneDecisionPoint({ operator, purpose: "morning_readiness", briefing, now, env: ON }, m.ports);
    expect(decision?.framing).toBe("implementation_intention");
    expect(m.observations[0]).toMatchObject({ sourceType: "daphne_decision_point", verificationStatus: "verified", payload: { availability: true } });
    const row = m.interventions[0]!;
    expect(row).toMatchObject({
      decisionPointId: decision!.decisionPointId,
      acceptableActions: ["plain_instruction", "implementation_intention", "choice_of_two"],
      selectionMode: "randomized",
      policyVersion: DAPHNE_DECISION_POINT_POLICY_VERSION,
      interventionDefinitionVersion: 1,
      proximalOutcomeWindowMinutes: 600,
      sourceObservationIds: ["obs_1"],
    });
    expect(row.selectionProbability).toBeCloseTo(1 / 3, 5);
    // A retried call reuses the stored assignment instead of drawing again.
    const again = await openDaphneDecisionPoint({ operator, purpose: "morning_readiness", briefing, now, env: ON }, { ...m.ports, random: () => 0.01 });
    expect(again?.framing).toBe("implementation_intention");
    expect(m.interventions).toHaveLength(1);
  });

  it("records only unavailability when there is nothing to frame", async () => {
    const m = memoryPorts();
    const empty = { ...briefing, driverDayLine: line("2026-10-21", []), tomorrow: [] };
    const decision = await openDaphneDecisionPoint({ operator, purpose: "evening_debrief", briefing: empty, now: new Date(), env: ON }, m.ports);
    expect(decision).toBeNull();
    expect(m.observations[0]).toMatchObject({ payload: { availability: false, unavailableReason: "no_open_item_tomorrow" } });
    expect(m.interventions).toHaveLength(0);
  });

  it("makes no decision and writes nothing when adaptation is revoked", async () => {
    const m = memoryPorts({ loadPreferences: async () => ({ adaptation_enabled: { status: "revoked", value: false } as never }) });
    expect(await openDaphneDecisionPoint({ operator, purpose: "morning_readiness", briefing, now: new Date(), env: ON }, m.ports)).toBeNull();
    expect(m.observations).toHaveLength(0);
  });
});

describe("Daphne decision points: proximal outcome from Day Line evidence only", () => {
  async function decided() {
    const m = memoryPorts();
    await openDaphneDecisionPoint({ operator, purpose: "morning_readiness", briefing, now: new Date("2026-10-21T14:00:00Z"), env: ON }, m.ports);
    return m;
  }
  const tz = "America/Los_Angeles";

  it("records started=1 when the target shows completion evidence inside the window", async () => {
    const m = await decided();
    const out = await evaluateDaphneDecisionOutcomes({ operator, now: new Date("2026-10-21T18:00:00Z"), timeZone: tz, env: ON,
      loadDayLine: async d => line(d, [stop("living-world-a", "Visit The Chadwick", "completed_with_evidence")]) }, m.ports);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ measureKey: "started", outcomeClass: "proximal", evidenceClass: "system_record", verificationStatus: "verified", value: { value: 1 } });
  });

  it("never counts an unverified mark or a call report, and waits until the window closes to record 0", async () => {
    const m = await decided();
    const marked = async (d: string) => line(d, [stop("living-world-a", "Visit The Chadwick", "completed_without_evidence")]);
    expect(await evaluateDaphneDecisionOutcomes({ operator, now: new Date("2026-10-21T18:00:00Z"), timeZone: tz, env: ON, loadDayLine: marked }, m.ports)).toHaveLength(0);
    const out = await evaluateDaphneDecisionOutcomes({ operator, now: new Date("2026-10-22T02:00:00Z"), timeZone: tz, env: ON, loadDayLine: marked }, m.ports);
    expect(out[0]).toMatchObject({ value: { value: 0, basis: "no_day_line_start_evidence_in_window", markedDoneWithoutEvidence: true } });
    expect(out[0]!.observedAt).toBe("2026-10-22T00:00:00.000Z");
    // Measured once.
    expect(await evaluateDaphneDecisionOutcomes({ operator, now: new Date("2026-10-22T03:00:00Z"), timeZone: tz, env: ON, loadDayLine: marked }, m.ports)).toHaveLength(0);
  });

  it("records nothing while the Day Line is unreadable", async () => {
    const m = await decided();
    const out = await evaluateDaphneDecisionOutcomes({ operator, now: new Date("2026-10-22T02:00:00Z"), timeZone: tz, env: ON,
      loadDayLine: async d => ({ ...line(d, []), read: "unread" }) }, m.ports);
    expect(out).toHaveLength(0);
  });
});

describe("Daphne decision points: what Claire is told", () => {
  it("adds one framing line to the morning conductor prompt and nothing when absent", () => {
    const base = { purpose: "morning_readiness", briefing: {} } as unknown as ShowrunnerCallState;
    expect(systemPrompt(base)).not.toMatch(/FRAMING FOR/);
    const decision = { interventionId: "dint_1", decisionPointId: "morning_first_action:2026-10-21:abc", kind: "morning_first_action" as const, framing: "choice_of_two" as const,
      target: { id: "a", title: "Visit The Chadwick", businessDate: "2026-10-21" }, second: { id: "b", title: "Visit Wilshire Vermont", businessDate: "2026-10-21" } };
    const prompt = systemPrompt({ ...base, daphneDecision: decision });
    expect(prompt).toMatch(/FRAMING FOR TODAY'S FIRST ACTION/);
    expect(prompt).toContain('"Visit The Chadwick" or "Visit Wilshire Vermont"');
    expect(daphneDecisionPromptLine(decision)).not.toMatch(/\b(cause|causes|caused|increase|improve|effective)\b/i);
  });
});
