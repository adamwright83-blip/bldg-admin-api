/**
 * Deterministic chapter → existing gameplay system binding.
 * Same chapter + same relevant state always yields the same binding.
 */

import type { ActionGrammar, ActionGrammarKind } from "./actionGrammar";
import type {
  CampaignChapter,
  CampaignChapterKind,
  GameplayBinding,
} from "./goldlineCampaign";
import type { GoldlineObjective } from "./goldlineAdventure";

export function eligibleBindingsForChapter(input: {
  chapterKind: CampaignChapterKind;
  objectives: readonly GoldlineObjective[];
}): GameplayBinding[] {
  switch (input.chapterKind) {
    case "expedition":
    case "hard_anchor":
      if (input.objectives.every(item => item.kind === "pickup" || item.kind === "delivery")) {
        return ["expedition", "direct_real_action"];
      }
      return ["direct_real_action", "action_grammar"];
    case "guardian_finale":
      return ["guardian_finale"];
    case "territory_push":
    case "visit_hunt":
      return input.objectives.length >= 2
        ? ["territory_push", "authoritative_visit_route", "action_grammar"]
        : ["territory_push", "action_grammar"];
    case "recovery_branch":
      return ["recovery", "action_grammar"];
    case "follow_up_branch":
      return ["action_grammar"];
    case "open_channel":
      return ["local_target_run", "direct_real_action"];
    case "return_to_stronghold":
      return ["world_exploration"];
    default:
      return input.objectives.length >= 2
        ? ["authoritative_visit_route", "action_grammar"]
        : ["action_grammar", "encounter"];
  }
}

export function selectGameplayBinding(input: {
  chapterKind: CampaignChapterKind;
  objectives: readonly GoldlineObjective[];
}): GameplayBinding {
  return eligibleBindingsForChapter(input)[0]!;
}

export function conversationSanctuaryRequired(objectives: readonly GoldlineObjective[]): boolean {
  return objectives.some(
    item => item.kind === "follow_up" || item.kind === "recovery" || item.kind === "field_capture"
  );
}

const CHAPTER_FICTION_TEMPLATE: Record<string, string | null> = {
  expedition: null,
  hard_anchor: null,
  guardian_finale: null,
  territory_push: "sealed-doors-v1",
  visit_hunt: "beacon-walk-v1",
  recovery_branch: "ghost-echo-v1",
  follow_up_branch: "held-breath-v1",
  open_channel: "watch-gate-v1",
  opportunity_corridor: "beacon-walk-v1",
  return_to_stronghold: null,
};

export function selectChapterFictionTemplateId(input: {
  chapterKind: CampaignChapterKind;
  objectives: readonly GoldlineObjective[];
}): string | null {
  if (conversationSanctuaryRequired(input.objectives)) {
    return input.objectives.some(item => item.kind === "recovery")
      ? "ghost-echo-v1"
      : "held-breath-v1";
  }
  return CHAPTER_FICTION_TEMPLATE[input.chapterKind] ?? null;
}

const CHAPTER_ACTION_GRAMMAR_KIND: Record<CampaignChapterKind, ActionGrammarKind | null> = {
  recovery_branch: "RECOVER_FAILED_CONTACT",
  follow_up_branch: "FOLLOW_UP_PERSON",
  visit_hunt: "VISIT_LOCATION",
  territory_push: "VISIT_LOCATION",
  opportunity_corridor: "VISIT_LOCATION",
  open_channel: "WAIT_FOR_EVENT",
  expedition: null,
  hard_anchor: null,
  guardian_finale: null,
  return_to_stronghold: null,
};

/**
 * Describe the current chapter's already-legitimate work as Action Grammar.
 * Fiction binds to this kind — not to a visit-route PLACE_ITEM default —
 * so preferred templates (ghost-echo, held-breath, beacon-walk) can match.
 * Empty location lists stay empty; this never invents addresses.
 */
export function deriveCampaignChapterActionGrammar(
  chapter: Pick<
    CampaignChapter,
    "chapterKind" | "stableChapterId" | "objectiveIds"
  >
): ActionGrammar | null {
  const kind = CHAPTER_ACTION_GRAMMAR_KIND[chapter.chapterKind];
  if (!kind) return null;
  if (chapter.objectiveIds.length === 0 && kind !== "WAIT_FOR_EVENT") return null;
  const count = Math.max(chapter.objectiveIds.length, 1);
  const sourceType =
    kind === "RECOVER_FAILED_CONTACT"
      ? "recovery"
      : kind === "FOLLOW_UP_PERSON"
        ? "follow_up"
        : kind === "VISIT_LOCATION"
          ? "field_move"
          : "mission";
  return {
    kind,
    businessActionId: chapter.objectiveIds[0] ?? chapter.stableChapterId,
    occurrenceId: null,
    sourceType,
    count,
    locations: [],
    channel:
      kind === "VISIT_LOCATION"
        ? "in_person"
        : kind === "FOLLOW_UP_PERSON"
          ? "phone"
          : "none",
    requiresTravel: kind === "VISIT_LOCATION",
    requiresDriving: kind === "VISIT_LOCATION",
    timerSafe: false,
    sensitiveConversation:
      kind === "FOLLOW_UP_PERSON" || kind === "RECOVER_FAILED_CONTACT",
  };
}
