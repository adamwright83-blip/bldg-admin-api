import {
  AUTHORED_BEAT_DEFAULTS,
  asNarrativeBeatId,
  InvalidNarrativeBeatIdError,
  type AuthoredBeat,
  type NarrativeBeatId,
  type NarrativeGraphEdge,
} from "../../shared/narratorOs/contracts";

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
 * Harness registry. Only named beats/missions already in GOLDLINE_CANON.md
 * (plus C-08 / K-COVE-ORIGIN as specified for chemist comparison and cove
 * origin-false). No CL-031 placeholders. No invented season population.
 * GOLDLINE_NARRATOR_CANON_PACKAGE.md is absent from the repo.
 */
export const AUTHORED_BEATS: readonly AuthoredBeat[] = Object.freeze([
  beat({
    id: C08,
    title: "Chemist comparison",
    canonStatus: "LOCKED",
    characters: ["Chemist"],
    authoredSourceRef: "GOLDLINE_CANON.md§1 chemist breadcrumb; §8 science",
    prerequisites: [
      {
        kind: "world_truth",
        factId: "17k_recorded_environmental_provenance_wrong",
      },
      {
        kind: "knowledge",
        plane: "CHEMIST",
        factId: "17k_recorded_environmental_provenance_wrong",
        mustKnow: true,
      },
      {
        kind: "verified_goldline_outcome",
        outcomeId: "17k_physically_evidenced_in_hand",
      },
    ],
    knowledgeRequirements: [
      {
        plane: "CHEMIST",
        factId: "17k_recorded_environmental_provenance_wrong",
        mustKnow: true,
      },
    ],
    knowledgeMutations: [
      {
        plane: "CHEMIST",
        factId: "c08_comparison_occurred",
        op: "learn",
        kind: "EVENT_FACT",
      },
    ],
    legalChemistVerdicts: ["SUPPORTS", "DOES_NOT_SUPPORT", "INSUFFICIENT"],
    prohibitedKnowledgeFactIds: C08_PROHIBITED,
    defaultSurface: true,
    playerVisibility: true,
    mayFireOffscreen: false,
    repeatability: "non_repeatable",
    irreversible: true,
  }),
  beat({
    id: K_COVE_ORIGIN,
    title: "Cove origin-false reveal",
    canonStatus: "LOCKED",
    characters: ["Claire"],
    authoredSourceRef: "GOLDLINE_CANON.md§1 cove; §5 Link 5 / cove",
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
    defaultSurface: true,
    playerVisibility: true,
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
    knowledgeMutations: [
      {
        plane: "PLAYER",
        factId: "constructedness_two_continuities_reconciled",
        op: "learn",
        kind: "EVENT_FACT",
      },
    ],
    prohibitedKnowledgeFactIds: CONSTRUCTEDNESS_PROHIBITED,
    defaultSurface: true,
    playerVisibility: true,
    mayFireOffscreen: false,
    repeatability: "non_repeatable",
    irreversible: true,
  }),
  missionBeat("M01", "FIRST LIGHT", "LOCKED", {
    authoredSourceRef: "GOLDLINE_CANON.md§4 M01",
    eligibilityConditions: [
      { kind: "never_manufacture", claim: "customers_or_results" },
    ],
  }),
  missionBeat("M02", "CONTAINMENT", "LOCKED", {
    authoredSourceRef: "GOLDLINE_CANON.md§4 M02",
    eligibilityConditions: [
      { kind: "never_manufacture", claim: "physical_verb_mismatch" },
    ],
  }),
  missionBeat("M03", "AFTER NO", "LOCKED", {
    authoredSourceRef: "GOLDLINE_CANON.md§4 M03",
    prerequisites: [
      {
        kind: "verified_goldline_any",
        outcomeIds: ["spoken_no", "silence_eligible_for_retry"],
      },
    ],
    eligibilityConditions: [{ kind: "never_manufacture", claim: "rejection" }],
    stateMutations: [{ key: "m03", value: "FIRED" }],
    quietBehavior: {
      closesForwardPossibility: true,
      holdWindow: null,
    },
  }),
  missionBeat("M04", "HELD", "LOCKED", {
    authoredSourceRef: "GOLDLINE_CANON.md§4 M04",
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
  }),
  ...(
    ["M16", "M17", "M18", "M19", "M20", "M21", "M22", "M23", "M24"] as const
  ).map(id =>
    missionBeat(id, null, "WORKING", {
      authoredSourceRef:
        "GOLDLINE_CANON.md§3 M16–M24 Operation 17-K; §5 WORKING titles",
      eligibilityConditions: [
        { kind: "never_manufacture", claim: "symbolic_rhyme_for_plot" },
      ],
    })
  ),
]);

export const AUTHORED_GRAPH: readonly NarrativeGraphEdge[] = Object.freeze([
  {
    fromId: null,
    toId: C08,
    kind: "hard_prereq",
    canonStatus: "LOCKED",
  },
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
    fromId: null,
    toId: CONSTRUCTEDNESS,
    kind: "unresolved_thread",
    canonStatus: "LOCKED",
  },
  {
    fromId: asNarrativeBeatId("M03"),
    toId: asNarrativeBeatId("M03"),
    kind: "quiet_closure",
    canonStatus: "LOCKED",
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
  K_COVE_ORIGIN,
  CONSTRUCTEDNESS,
  M01: asNarrativeBeatId("M01"),
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
