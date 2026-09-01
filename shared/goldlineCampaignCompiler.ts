/**
 * Campaign compiler. Ordering comes from compileGoldlineAdventure.
 * This layer names the arc, bindings, and archetype — it does not invent work.
 */

import { compileGoldlineAdventure, type GoldlineObjective } from "./goldlineAdventure";
import {
  CAMPAIGN_RULES_VERSION,
  campaignInputFingerprint,
  campaignStableKey,
  stableCampaignChapterId,
  type CampaignChapter,
  type CampaignChapterKind,
  type CampaignCompileInput,
  type CampaignDraft,
  type CampaignPhase,
  type TerritoryCampaignHint,
} from "./goldlineCampaign";
import { CAMPAIGN_ARCHETYPES, selectCampaignArchetype } from "./goldlineCampaignArchetypes";
import {
  eligibleBindingsForChapter,
  selectChapterFictionTemplateId,
  selectGameplayBinding,
} from "./goldlineCampaignBindings";

function chapterKindFor(input: {
  objectives: readonly GoldlineObjective[];
  territoryId: string | null;
}): CampaignChapterKind {
  if (input.objectives.every(item => item.kind === "pickup" || item.kind === "delivery") &&
      input.objectives.every(item => item.authority === "fixed_commitment")) {
    return "expedition";
  }
  if (input.objectives.every(item => item.authority === "fixed_commitment")) return "hard_anchor";
  if (input.objectives.every(item => item.kind === "recovery")) return "recovery_branch";
  if (input.objectives.every(item => item.kind === "follow_up")) return "follow_up_branch";
  if (input.territoryId) return "territory_push";
  if (input.objectives.every(item => item.kind === "commercial_visit")) return "visit_hunt";
  if (input.objectives.every(item => item.kind === "field_capture")) return "open_channel";
  return "opportunity_corridor";
}

function phaseFor(index: number, total: number, kind: CampaignChapterKind): CampaignPhase {
  if (kind === "guardian_finale") return "climax";
  if (total <= 1) return "opening";
  if (index === 0) return "opening";
  if (index === total - 1) return kind === "hard_anchor" ? "climax" : "epilogue";
  if (index === Math.floor(total / 2)) return "turn";
  return "rising";
}

function territoryFor(
  objectives: readonly GoldlineObjective[],
  territories: readonly TerritoryCampaignHint[]
): TerritoryCampaignHint | null {
  const ids = new Set(objectives.map(item => item.physicalEntityId).filter(Boolean));
  return (
    territories.find(territory =>
      territory.memberPhysicalEntityIds.some(id => ids.has(id))
    ) ?? null
  );
}

/**
 * Compose today's campaign from already-legitimate objectives.
 * Empty ready work yields a quiet draft with no fabricated chapters.
 */
export function compileGoldlineCampaign(input: CampaignCompileInput): CampaignDraft {
  const adventure = compileGoldlineAdventure({
    date: input.businessDate,
    objectives: [...input.objectives],
    territoryBundles: (input.territories ?? []).map(item => ({
      territoryId: item.territoryId,
      memberPhysicalEntityIds: item.memberPhysicalEntityIds,
    })),
  });
  const archetypeId = selectCampaignArchetype({
    objectives: input.objectives,
    territories: input.territories,
  });
  const archetype = CAMPAIGN_ARCHETYPES[archetypeId];
  const chapters: CampaignChapter[] = adventure.chapters.map((primitive, index) => {
    const objectives = primitive.objectiveIds
      .map(id => adventure.ordered.find(item => item.id === id))
      .filter((item): item is GoldlineObjective => Boolean(item));
    const territory = territoryFor(objectives, input.territories ?? []);
    const chapterKind = chapterKindFor({
      objectives,
      territoryId: territory?.territoryId ?? null,
    });
    const eligible = eligibleBindingsForChapter({ chapterKind, objectives });
    const selected = selectGameplayBinding({ chapterKind, objectives });
    return {
      stableChapterId: stableCampaignChapterId({
        businessDate: input.businessDate,
        chapterKind,
        objectiveIds: primitive.objectiveIds,
        territoryId: territory?.territoryId,
      }),
      chapterKind,
      objectiveIds: primitive.objectiveIds,
      required: primitive.fixed,
      hardAnchor: primitive.fixed,
      campaignPhase: phaseFor(index, adventure.chapters.length, chapterKind),
      eligibleGameplayBindings: eligible,
      selectedGameplayBinding: selected,
      territoryId: territory?.territoryId ?? null,
      fictionalTreatment: index === 0 ? archetype.openingTreatment : archetype.transitionVocabulary,
      fictionTemplateId: selectChapterFictionTemplateId({ chapterKind, objectives }),
      physicalAnchors: objectives.map(item => ({
        physicalEntityId: item.physicalEntityId,
        latitude: item.latitude,
        longitude: item.longitude,
      })),
    };
  });
  for (const territory of input.territories ?? []) {
    if (!territory.confrontationReady || territory.cleared) continue;
    const chapterKind = "guardian_finale" as const;
    chapters.push({
      stableChapterId: stableCampaignChapterId({
        businessDate: input.businessDate,
        chapterKind,
        objectiveIds: [],
        territoryId: territory.territoryId,
      }),
      chapterKind,
      objectiveIds: [],
      required: true,
      hardAnchor: false,
      campaignPhase: "climax",
      eligibleGameplayBindings: ["guardian_finale"],
      selectedGameplayBinding: "guardian_finale",
      territoryId: territory.territoryId,
      fictionalTreatment: archetype.climaxPreference === "guardian_finale"
        ? "The Guardian is derived-ready. The finale is game-only."
        : archetype.completionTreatment,
      fictionTemplateId: null,
      physicalAnchors: [],
    });
  }
  const readyCount = input.objectives.filter(item => item.status === "ready").length;
  const continuityTitle =
    input.priorCampaignTitle === "THE BROKEN CROWN" && archetypeId === "broken_crown"
      ? "AFTER THE CROWN"
      : null;
  return {
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    businessDate: input.businessDate,
    rulesVersion: CAMPAIGN_RULES_VERSION,
    campaignArchetypeId: archetypeId,
    stableKey: campaignStableKey(input),
    inputFingerprint: campaignInputFingerprint(input),
    title: readyCount === 0 ? "OPEN SKY" : continuityTitle ?? archetype.name,
    premise: readyCount === 0 ? CAMPAIGN_ARCHETYPES.open_sky.premise : archetype.premise,
    chapters,
    currentChapterId: chapters[0]?.stableChapterId ?? null,
    completedChapterIds: [],
    status: readyCount === 0 ? "quiet" : "authored",
    endingTreatment: null,
    authoritativeCompletedObjectiveIds: input.objectives
      .filter(item => item.status === "completed")
      .map(item => item.id)
      .sort(),
  };
}
