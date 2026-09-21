import {
  AUTHORED_BEAT_DEFAULTS,
  asNarrativeBeatId,
  InvalidNarrativeBeatIdError,
  type AuthoredBeat,
  type NarrativeBeatId,
  type NarrativeGraphEdge,
} from "../../shared/narratorOs/contracts";
import {
  AUTHORED_NARRATIVE_FACTS,
  CHEMIST_NON_SUPPORTIVE_RESULTS,
} from "./authoredNarrativeFacts";
import { M03_ARM_OUTCOME_IDS, M03_RETURN_OUTCOME_IDS } from "./m03Readiness";

const beat = (
  partial: Omit<AuthoredBeat, keyof typeof AUTHORED_BEAT_DEFAULTS> &
    Partial<AuthoredBeat> & { id: string }
): AuthoredBeat => {
  const id = asNarrativeBeatId(partial.id);
  return {
    ...AUTHORED_BEAT_DEFAULTS,
    ...partial,
    id,
    title: partial.title ?? null,
    nextBeatIds: partial.nextBeatIds ?? AUTHORED_BEAT_DEFAULTS.nextBeatIds,
    prohibitedKnowledgeFactIds:
      partial.prohibitedKnowledgeFactIds ??
      AUTHORED_BEAT_DEFAULTS.prohibitedKnowledgeFactIds,
  };
};

const C08 = asNarrativeBeatId("C-08");
const C06 = asNarrativeBeatId("C-06");
const K_COVE_ORIGIN = asNarrativeBeatId("K-COVE-ORIGIN");
const CONSTRUCTEDNESS = asNarrativeBeatId("constructedness");

const C08_PROHIBITED = [
  "antarctica_is_father_reveal",
  "portals",
  "source_woman_father_was_17k_provenance_lead",
  "broad_dimensional_theory",
  "unrelated_exposition",
] as const;

const CONSTRUCTEDNESS_PROHIBITED = [
  "source_woman_is_not_named_claire",
  "source_woman_created_goldline",
  "lot_17k_officially_mediterranean_archaeological",
  "antarctica_is_father_reveal",
] as const;

function missionBeat(
  id: string,
  title: string | null,
  canonStatus: AuthoredBeat["canonStatus"],
  extra: Partial<AuthoredBeat> = {}
): AuthoredBeat {
  return beat({
    id,
    title,
    canonStatus,
    characters: ["Claire"],
    authoredSourceRef:
      canonStatus === "WORKING"
        ? "GOLDLINE_CANON.md§5 WORKING mission titles/numbers"
        : (extra.authoredSourceRef ?? "GOLDLINE_CANON.md§4"),
    ...extra,
  });
}

/**
 * Typed runtime registry reconciled to GOLDLINE_CANON.md v1.1 plus the
 * reviewed D.5 package (v1.2-proposed). The Markdown package is repo
 * authority for authoring, not an executable schema. Runtime stays typed.
 * Do not parse GOLDLINE_NARRATOR_CANON_PACKAGE.md at runtime.
 *
 * M05–M14 are intentionally absent. Incomplete named beats stay
 * INCOMPLETE. OPEN stays OPEN. After-No readiness is per-target state,
 * not a separate beat. A missed hold does not fire a beat.
 * CL disclosure lives in a separate immutable catalog, not here.
 */
export const INTENTIONALLY_ABSENT_MISSION_IDS = [
  "M05",
  "M06",
  "M07",
  "M08",
  "M09",
  "M10",
  "M11",
  "M12",
  "M13",
  "M14",
] as const;

export const AUTHORED_BEATS: readonly AuthoredBeat[] = Object.freeze([
  beat({
    id: C08,
    title: "STRONG COMPARISON",
    canonStatus: "LOCKED",
    characters: ["Chemist"],
    authoredSourceRef: "GOLDLINE_CANON.md§1 chemist breadcrumb; package C-08",
    eligibilityDefinition: "COMPLETE",
    defaultSurface: true,
    playerVisibility: true,
    prerequisites: [
      {
        kind: "narrative_state",
        key: AUTHORED_NARRATIVE_FACTS.reservedCorePreserved,
        equals: "true",
      },
      {
        kind: "narrative_state",
        key: AUTHORED_NARRATIVE_FACTS.lot17kPhysicallyInHand,
        equals: "true",
      },
    ],
    knowledgeMutations: [
      {
        plane: "PLAYER",
        factId: "c08_comparison_occurred",
        op: "learn",
        kind: "EVENT_FACT",
      },
      {
        plane: "CHEMIST",
        factId: "c08_comparison_occurred",
        op: "learn",
        kind: "EVENT_FACT",
      },
      {
        plane: "CLAIRE",
        factId: "c08_comparison_occurred",
        op: "learn",
        kind: "EVENT_FACT",
      },
    ],
    legalChemistVerdicts: ["SUPPORTS", "DOES_NOT_SUPPORT", "INSUFFICIENT"],
    prohibitedKnowledgeFactIds: C08_PROHIBITED,
    mayFireOffscreen: false,
    repeatability: "non_repeatable",
    irreversible: true,
  }),
  beat({
    id: C06,
    title: "WE'RE NOT SHIPPING IT",
    canonStatus: "LOCKED",
    characters: ["Claire", "Chemist"],
    authoredSourceRef: "GOLDLINE_CANON.md§8 power split; package C-06",
    eligibilityDefinition: "COMPLETE",
    defaultSurface: false,
    playerVisibility: false,
    prerequisites: [
      {
        kind: "narrative_state",
        key: AUTHORED_NARRATIVE_FACTS.chemistNonSupportiveResult,
        equalsAny: CHEMIST_NON_SUPPORTIVE_RESULTS,
      },
    ],
    mayFireOffscreen: false,
    repeatability: "repeatable",
    irreversible: false,
  }),
  beat({
    id: K_COVE_ORIGIN,
    title: "Cove origin-false reveal",
    canonStatus: "LOCKED",
    characters: ["Claire"],
    authoredSourceRef: "GOLDLINE_CANON.md§1 cove; §5 Link 5 / cove",
    eligibilityDefinition: "INCOMPLETE",
    eligibilityIncompleteReason:
      "K-COVE-ORIGIN playable cove is INCOMPLETE. Origin-false without Chemist / chemist-skip remains OPEN. C-08 is not a hard prereq and does not complete this beat.",
    prerequisites: [
      {
        kind: "optional_beat",
        beatId: C08,
      },
      {
        kind: "open_policy",
        policyId: "origin_false_without_chemist",
        canonStatus: "OPEN",
      },
    ],
    knowledgeMutations: [
      {
        plane: "PLAYER",
        factId: "cove_origin_false",
        op: "learn",
        kind: "EVENT_FACT",
      },
    ],
    prohibitedKnowledgeFactIds: [
      "antarctica_is_father_reveal",
      "source_woman_father_was_17k_provenance_lead",
    ],
    mayFireOffscreen: false,
    repeatability: "non_repeatable",
    irreversible: true,
  }),
  beat({
    id: CONSTRUCTEDNESS,
    title: "Constructedness event",
    canonStatus: "LOCKED",
    characters: ["Claire"],
    authoredSourceRef: "GOLDLINE_CANON.md§5 constructedness event",
    eligibilityDefinition: "INCOMPLETE",
    eligibilityIncompleteReason:
      "Constructedness / N-TWO-CLAIRES remains INCOMPLETE: late Act III is not a predicate and the inspectable artifact is not specified as data. Missing gates are not permission.",
    knowledgeMutations: [
      {
        plane: "PLAYER",
        factId: "constructedness_two_continuities_reconciled",
        op: "learn",
        kind: "EVENT_FACT",
      },
    ],
    prohibitedKnowledgeFactIds: CONSTRUCTEDNESS_PROHIBITED,
    playerVisibility: true,
    mayFireOffscreen: false,
    repeatability: "non_repeatable",
    irreversible: true,
  }),
  missionBeat("M01", "FIRST LIGHT", "LOCKED", {
    authoredSourceRef: "GOLDLINE_CANON.md§4 M01",
    eligibilityDefinition: "COMPLETE",
    defaultSurface: true,
    playerVisibility: true,
    prerequisites: [
      {
        kind: "verified_goldline_any",
        outcomeIds: [
          "physical_first_visit",
          "dormant_known_customer_reactivation",
          "warm_first_outbound",
        ],
      },
    ],
    eligibilityConditions: [
      { kind: "never_manufacture", claim: "customers_or_results" },
    ],
  }),
  missionBeat("M02", "CONTAINMENT", "LOCKED", {
    authoredSourceRef: "GOLDLINE_CANON.md§4 M02",
    eligibilityDefinition: "INCOMPLETE",
    eligibilityIncompleteReason:
      "GOLDLINE_CANON.md §4 lists M02 allowed action families and truthful-verb rules, but does not define campaign spawn/eligibility relative to prior mission state. An allow-list is not a complete eligibility definition. Known family evidence stays encoded; the missing spawn rule is not invented.",
    defaultSurface: true,
    playerVisibility: true,
    prerequisites: [
      {
        kind: "verified_goldline_any",
        outcomeIds: [
          "leave_real_packet_or_collateral",
          "approved_physical_placement",
          "in_app_verify_placement_just_performed",
        ],
      },
    ],
    eligibilityConditions: [
      { kind: "never_manufacture", claim: "physical_verb_mismatch" },
    ],
  }),
  missionBeat("M03", "AFTER NO", "LOCKED", {
    authoredSourceRef: "GOLDLINE_CANON.md§4 M03; package M03",
    eligibilityDefinition: "COMPLETE",
    defaultSurface: true,
    playerVisibility: true,
    prerequisites: [
      {
        kind: "verified_goldline_same_target",
        priorOutcomeIds: M03_ARM_OUTCOME_IDS,
        subsequentOutcomeIds: M03_RETURN_OUTCOME_IDS,
      },
    ],
    eligibilityConditions: [{ kind: "never_manufacture", claim: "rejection" }],
    repeatability: "repeatable",
    irreversible: false,
    quietBehavior: {
      closesForwardPossibility: false,
      holdWindow: null,
    },
  }),
  missionBeat("M04", "HELD", "LOCKED", {
    authoredSourceRef: "GOLDLINE_CANON.md§4 M04; package M04",
    eligibilityDefinition: "COMPLETE",
    defaultSurface: true,
    playerVisibility: true,
    prerequisites: [
      {
        kind: "verified_goldline_any",
        outcomeIds: [
          "kept_promised_send_visit_or_call",
          "legitimate_physical_run_inside_real_window",
        ],
      },
    ],
    stateMutations: [{ key: "act_i", value: "complete" }],
    quietBehavior: {
      closesForwardPossibility: false,
      holdWindow: {
        key: "m04_hold",
        durationMs: null,
        canonStatus: "WORKING",
      },
    },
  }),
  missionBeat("M15", "Formal qualification", "LOCKED", {
    authoredSourceRef: "GOLDLINE_CANON.md§3 M15",
    eligibilityDefinition: "INCOMPLETE",
    eligibilityIncompleteReason:
      "M15 is named as formal qualification; GOLDLINE_CANON.md does not supply a complete machine-readable eligibility graph. Missing gates are not permission.",
  }),
  ...(
    ["M16", "M17", "M18", "M19", "M20", "M21", "M22", "M23", "M24"] as const
  ).map(id =>
    missionBeat(id, null, "WORKING", {
      authoredSourceRef:
        "GOLDLINE_CANON.md§3 M16–M24 Operation 17-K; §5 WORKING titles",
      eligibilityDefinition: "INCOMPLETE",
      eligibilityIncompleteReason:
        "M16–M24 / Operation 17-K remain INCOMPLETE. Package does not mark them COMPLETE. Missing gates are not permission.",
      eligibilityConditions: [
        { kind: "never_manufacture", claim: "symbolic_rhyme_for_plot" },
      ],
    })
  ),
]);

export const AUTHORED_GRAPH: readonly NarrativeGraphEdge[] = Object.freeze([
  {
    fromId: C08,
    toId: K_COVE_ORIGIN,
    kind: "optional",
    canonStatus: "LOCKED",
  },
  {
    fromId: C08,
    toId: K_COVE_ORIGIN,
    kind: "open_unresolved",
    canonStatus: "OPEN",
    policyId: "origin_false_without_chemist",
  },
  {
    fromId: asNarrativeBeatId("M04"),
    toId: asNarrativeBeatId("M04"),
    kind: "unresolved_thread",
    canonStatus: "LOCKED",
  },
]);

export const BEAT_IDS = {
  C08,
  C06,
  K_COVE_ORIGIN,
  CONSTRUCTEDNESS,
  M01: asNarrativeBeatId("M01"),
  M02: asNarrativeBeatId("M02"),
  M03: asNarrativeBeatId("M03"),
  M04: asNarrativeBeatId("M04"),
} as const;

export function getAuthoredRegistry(): readonly AuthoredBeat[] {
  return AUTHORED_BEATS;
}

export function getAuthoredGraph(): readonly NarrativeGraphEdge[] {
  return AUTHORED_GRAPH;
}

export function getBeat(id: string): AuthoredBeat {
  const beatId = asNarrativeBeatId(id);
  const found = AUTHORED_BEATS.find(entry => entry.id === beatId);
  if (!found) throw new InvalidNarrativeBeatIdError(id);
  return found;
}

export function isKnownBeatId(id: string): boolean {
  try {
    const beatId = asNarrativeBeatId(id);
    return AUTHORED_BEATS.some(entry => entry.id === beatId);
  } catch {
    return false;
  }
}

export function offscreenCatalog(
  registry: readonly AuthoredBeat[] = AUTHORED_BEATS
): readonly AuthoredBeat[] {
  return registry.filter(entry => entry.mayFireOffscreen === true);
}

export function assertNoPlaceholderBeats(
  registry: readonly AuthoredBeat[] = AUTHORED_BEATS
): void {
  for (const entry of registry) {
    if (/^CL-\d+$/i.test(entry.id)) {
      throw new Error(`Placeholder beat id is not legal: ${entry.id}`);
    }
  }
}

export function originFalseWithoutChemistIsOpen(
  graph: readonly NarrativeGraphEdge[] = AUTHORED_GRAPH
): boolean {
  const coveFromC08 = graph.filter(
    edge => edge.fromId === C08 && edge.toId === K_COVE_ORIGIN
  );
  const hardRequired = coveFromC08.some(edge => edge.kind === "hard_prereq");
  const skipSynthesized = coveFromC08.some(
    edge => edge.policyId === "chemist_skip_allowed"
  );
  const open = coveFromC08.some(
    edge => edge.kind === "open_unresolved" && edge.canonStatus === "OPEN"
  );
  return open && !hardRequired && !skipSynthesized;
}

export function hasChemistSkipPolicy(
  graph: readonly NarrativeGraphEdge[] = AUTHORED_GRAPH
): boolean {
  return graph.some(edge => edge.policyId === "chemist_skip_allowed");
}
