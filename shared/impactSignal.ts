/**
 * FIELD INTEL CAPTURE — remembering things nobody designed a field for.
 *
 * Across ten real operating days the operator will learn things the software
 * was never built to hold: that a building bans solicitation, that a manager
 * already buys from Tide, that the receptionist will hand over the GM's email.
 * The point of this model is that "I just realised this matters, start
 * remembering it" has to work at the moment of realisation — not after a
 * schema change, a deploy, and a migration.
 *
 * So the schema is STABLE and the vocabulary is OPEN. A signal is always
 * (signalKey, value, provenance, when, what it was about). A brand-new kind of
 * observation is a new `signalKey`, never a new column. That is the difference
 * between a system that can learn on Day 6 and one that can only be taught
 * between releases.
 *
 * THE OTHER HALF is refusing to let captured effort masquerade as outcome.
 * Thirty-five door hangers is real work and worth remembering; it is not a
 * lead, a customer, or a dollar. Every signal therefore carries an explicit
 * impact class, and nothing in this file will ever infer a stronger one than
 * the operator stated.
 */

/**
 * Where the information came from. Never upgraded: an operator's observation
 * stays an operator's observation for the life of the record, however many
 * times it is corroborated. Corroboration is a second signal, not a promotion
 * of the first.
 */
export const SIGNAL_PROVENANCES = [
  /** The system observed it itself — a real write, a real timestamp. */
  "system_verified",
  /** A person said it and confirmed it. Most field intel is this. */
  "operator_confirmed",
  /** It came from somebody else's record or system. */
  "external_record",
] as const;
export type SignalProvenance = (typeof SIGNAL_PROVENANCES)[number];

/**
 * What kind of business fact this is.
 *
 * The ordering is deliberate and load-bearing: it is the funnel, and a signal
 * may never be counted at a class stronger than the one captured. Conflating
 * these is how a day of honest legwork turns into a fabricated pipeline.
 */
export const IMPACT_CLASSES = [
  /**
   * Something true about the world. Unit counts, competitor presence,
   * solicitation policy, who actually holds the decision. Carries no funnel
   * meaning at all — and most field intel lands here, which is fine. Knowing
   * a building has 180 units is valuable precisely because it is not a claim
   * about having sold anything.
   */
  "observation",
  /** Effort the operator expended. Hangers dropped, doors knocked, calls made. */
  "field_activity",
  /** The other side did something back. Asked for pricing, took a card. */
  "response",
  /** A concrete next step exists. A meeting on a date, a quote requested. */
  "opportunity",
  /** A real customer now exists. */
  "customer_outcome",
  /** Money. Recurring or one-off, attributable and real. */
  "economic_outcome",
] as const;
export type ImpactClass = (typeof IMPACT_CLASSES)[number];

/**
 * How to read a signal's value. Kept small on purpose — this is about
 * rendering and aggregation, not about validating the world.
 */
export const SIGNAL_VALUE_TYPES = [
  "text",
  "number",
  "boolean",
  "enum",
  "date",
] as const;
export type SignalValueType = (typeof SIGNAL_VALUE_TYPES)[number];

export type ImpactSignal = {
  id: string;
  /** Ties a signal to a push, so ten days of work can be analysed as one. */
  campaignId: string | null;
  businessDate: string;
  /** Stable machine key, e.g. `building_solicitation_policy`. */
  signalKey: string;
  /** What a person calls it. Free to improve without touching the key. */
  label: string;
  valueType: SignalValueType;
  /** Always stored as text; `valueType` says how to read it. */
  value: string;
  unit: string | null;
  impactClass: ImpactClass;
  provenance: SignalProvenance;
  /** What the signal is about — a building, an account, a person. */
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  location: string | null;
  notes: string | null;
  /**
   * Anything structured that has no column and does not deserve one. This is
   * what makes a novel observation storable today rather than next release.
   */
  metadata: Record<string, unknown> | null;
  capturedAt: string;
  /** Null until a person confirms it. An unconfirmed signal is a proposal. */
  confirmedAt: string | null;
};

/**
 * A signal the operator has decided is worth asking about repeatedly.
 *
 * Definitions are additive and never rewrite history: promoting
 * `building_has_package_lockers` into a standard question later does not
 * require touching the signals already captured under that key, because they
 * already carry the key, the label, and the value type. That is the whole
 * reason those three live on every row rather than only on the definition.
 */
export type TrackedSignalDefinition = {
  id: string;
  signalKey: string;
  label: string;
  valueType: SignalValueType;
  impactClass: ImpactClass;
  /** What kind of thing this question is about, e.g. "building". */
  appliesTo: string | null;
  unit: string | null;
  /** Allowed values for an enum signal, in display order. */
  options: string[] | null;
  /** True once it should be offered as a standard question. */
  promoted: boolean;
  observedCount: number;
  createdAt: string;
};

/** One signal as PROPOSED from speech, before any human has confirmed it. */
export type ProposedImpactSignal = {
  signalKey: string;
  label: string;
  valueType: SignalValueType;
  value: string;
  unit: string | null;
  impactClass: ImpactClass;
  entityType: string | null;
  entityLabel: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  /**
   * True when the operator was explicitly asking to START tracking something
   * new, rather than just recording one instance of it. Drives whether a
   * tracked definition is offered.
   */
  startsTracking: boolean;
};

export type ImpactSignalProposal = {
  proposalId: string;
  signals: ProposedImpactSignal[];
  /** Speech that produced no recognisable signal, reported rather than hidden. */
  unrecognized: string | null;
};

const CLASS_RANK: Record<ImpactClass, number> = {
  observation: 0,
  field_activity: 1,
  response: 2,
  opportunity: 3,
  customer_outcome: 4,
  economic_outcome: 5,
};

/**
 * Whether `candidate` is a stronger business claim than `current`.
 *
 * Exists so aggregation code has one place to ask the question, instead of
 * each call site inventing its own ordering and eventually getting it wrong in
 * the direction that flatters the numbers.
 */
export function isStrongerImpactClass(
  candidate: ImpactClass,
  current: ImpactClass
): boolean {
  return CLASS_RANK[candidate] > CLASS_RANK[current];
}

/**
 * The Impact Ledger's view: counts per class, never collapsed into one score.
 *
 * There is deliberately no `total`. A single number would require deciding how
 * many door hangers equal a customer, and any answer to that is a fabrication.
 * The classes stay side by side so the operator can see a real day of work
 * without it being laundered into pipeline.
 */
export type ImpactLedgerTally = {
  campaignId: string | null;
  counts: Record<ImpactClass, number>;
  /** Summed numeric values per signalKey — e.g. 35 + 40 door hangers. */
  quantities: Array<{
    signalKey: string;
    label: string;
    unit: string | null;
    total: number;
    impactClass: ImpactClass;
  }>;
  /** Confirmed signals only. Proposals are not evidence. */
  confirmedSignalCount: number;
};

export function tallyImpactSignals(
  signals: readonly ImpactSignal[],
  campaignId: string | null = null
): ImpactLedgerTally {
  const counts = Object.fromEntries(
    IMPACT_CLASSES.map(cls => [cls, 0])
  ) as Record<ImpactClass, number>;
  const quantityMap = new Map<string, ImpactLedgerTally["quantities"][number]>();

  let confirmedSignalCount = 0;
  for (const signal of signals) {
    // Unconfirmed signals are proposals, and a proposal is not evidence. This
    // is the same rule the screenshot import follows: a machine's reading
    // never becomes business truth without a person.
    if (!signal.confirmedAt) continue;
    confirmedSignalCount += 1;
    counts[signal.impactClass] += 1;

    if (signal.valueType !== "number") continue;
    const amount = Number(signal.value);
    if (!Number.isFinite(amount)) continue;
    const existing = quantityMap.get(signal.signalKey);
    if (existing) {
      existing.total += amount;
      continue;
    }
    quantityMap.set(signal.signalKey, {
      signalKey: signal.signalKey,
      label: signal.label,
      unit: signal.unit,
      total: amount,
      impactClass: signal.impactClass,
    });
  }

  return {
    campaignId,
    counts,
    quantities: Array.from(quantityMap.values()).sort((a, b) =>
      a.signalKey.localeCompare(b.signalKey)
    ),
    confirmedSignalCount,
  };
}

/**
 * Turns whatever a person typed into a stable machine key.
 *
 * Deterministic so the same observation captured on Day 2 and Day 9 lands
 * under the same key and can actually be compared — which is the entire point
 * of capturing it in the first place.
 */
export function toSignalKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
}

/** Human-readable impact class, for the ledger and the case study. */
export function impactClassLabel(impactClass: ImpactClass): string {
  switch (impactClass) {
    case "observation":
      return "OBSERVATION";
    case "field_activity":
      return "FIELD ACTIVITY";
    case "response":
      return "RESPONSE";
    case "opportunity":
      return "OPPORTUNITY";
    case "customer_outcome":
      return "CUSTOMER";
    case "economic_outcome":
      return "ECONOMIC OUTCOME";
  }
}

export function signalProvenanceLabel(provenance: SignalProvenance): string {
  switch (provenance) {
    case "system_verified":
      return "SYSTEM VERIFIED";
    case "operator_confirmed":
      return "OPERATOR OBSERVATION";
    case "external_record":
      return "EXTERNAL RECORD";
  }
}
