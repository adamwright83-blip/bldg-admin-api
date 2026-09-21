import {
  openValueMustBeNull,
  type AuthoredFact,
} from "../../shared/narratorOs/contracts";

/**
 * WORLD_TRUTH — authored underlying canon. Narrator cannot rewrite it.
 * Sourced from GOLDLINE_CANON.md v1.1 on origin/main. GOLDLINE_NARRATOR_CANON_PACKAGE.md
 * is not in the repository; this catalog does not invent package IDs.
 *
 * OPEN facts are present as slots with `value: null`. Runtime must not fill them.
 */
export const NARRATOR_WORLD_TRUTH_VERSION = "goldline-canon-1.1-world-truth";

export const WORLD_TRUTH_FACTS: readonly AuthoredFact[] = Object.freeze([
  {
    factId: "source_woman_is_not_named_claire",
    kind: "EVENT_FACT",
    canonStatus: "LOCKED",
    value: "Source Woman is a real living woman. She is not named Claire.",
    authoredSourceRef: "GOLDLINE_CANON.md§7",
  },
  {
    factId: "source_woman_created_goldline",
    kind: "EVENT_FACT",
    canonStatus: "LOCKED",
    value:
      "Source Woman created Goldline, AI Claire (from herself, identity-altered), and Trailblazer likeness.",
    authoredSourceRef: "GOLDLINE_CANON.md§7",
  },
  {
    factId: "source_woman_father_was_17k_provenance_lead",
    kind: "EVENT_FACT",
    canonStatus: "LOCKED",
    value:
      "Source Woman's real father was the provenance lead connected to lot 17-K. He followed the contradiction and disappeared. There is not a second lost rider.",
    authoredSourceRef: "GOLDLINE_CANON.md§1",
  },
  {
    factId: "17k_recorded_environmental_provenance_wrong",
    kind: "EVENT_FACT",
    canonStatus: "LOCKED",
    value: "Recorded environmental provenance is wrong.",
    authoredSourceRef: "GOLDLINE_CANON.md§1 chemist breadcrumb",
  },
  {
    factId: "lot_17k_officially_mediterranean_archaeological",
    kind: "EVENT_FACT",
    canonStatus: "LOCKED",
    value: "Lot 17-K is officially Mediterranean archaeological material.",
    authoredSourceRef: "GOLDLINE_CANON.md§1",
  },
  {
    factId: "cove_origin_false",
    kind: "EVENT_FACT",
    canonStatus: "LOCKED",
    value:
      "Cove is origin reveal only. Source Woman's father is absent. 17-K did not originate where the file says.",
    authoredSourceRef: "GOLDLINE_CANON.md§1",
  },
  {
    factId: "antarctica_is_father_reveal",
    kind: "EVENT_FACT",
    canonStatus: "LOCKED",
    value:
      "Antarctica is where the truth of what happened to Source Woman's father is revealed.",
    authoredSourceRef: "GOLDLINE_CANON.md§1",
  },
  {
    factId: "contained_thing_nature",
    kind: "EVENT_FACT",
    canonStatus: "OPEN",
    value: null,
    authoredSourceRef: "GOLDLINE_CANON.md§1 OPEN",
  },
  {
    factId: "source_woman_real_name",
    kind: "EVENT_FACT",
    canonStatus: "OPEN",
    value: null,
    authoredSourceRef: "GOLDLINE_CANON.md§7 OPEN",
  },
  {
    factId: "chemist_name",
    kind: "EVENT_FACT",
    canonStatus: "OPEN",
    value: null,
    authoredSourceRef: "GOLDLINE_CANON.md§8 OPEN",
  },
  {
    factId: "player_trailblazer_control",
    kind: "EVENT_FACT",
    canonStatus: "OPEN",
    value: null,
    authoredSourceRef: "GOLDLINE_CANON.md§5 OPEN",
  },
  {
    factId: "origin_false_without_chemist_policy",
    kind: "EVENT_FACT",
    canonStatus: "OPEN",
    value: null,
    authoredSourceRef:
      "GOLDLINE_CANON.md cove origin-false; chemist comparison policy OPEN",
  },
]);

for (const fact of WORLD_TRUTH_FACTS) openValueMustBeNull(fact);

export function worldTruthFact(factId: string): AuthoredFact | undefined {
  return WORLD_TRUTH_FACTS.find(fact => fact.factId === factId);
}

export function worldTruthValue(factId: string): string | null {
  const fact = worldTruthFact(factId);
  if (!fact) return null;
  if (fact.canonStatus === "OPEN") return null;
  return fact.value;
}
