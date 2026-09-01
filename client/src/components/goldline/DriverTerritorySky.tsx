import { useState } from "react";
import { guardianById } from "@shared/goldlineGuardians";
import { challengeSummary } from "@shared/goldlineTerritories";
import { trpc } from "@/lib/trpc";
import { GuardianActor } from "@/components/goldline/GuardianActor";
import { GuardianEncounter } from "@/components/goldline/GuardianEncounter";
import { useReducedMotionFlag } from "@/components/goldline/TerritoryWorldLayer";
import "@/components/goldline/goldline-territories.css";

export function DriverTerritorySky({
  driving = false,
  onEncounterChange,
}: {
  driving?: boolean;
  onEncounterChange?: (active: boolean) => void;
}) {
  const territories = trpc.system.goldlineWorld.territories.useQuery(undefined, {
    staleTime: 15_000,
  });
  const campaign = trpc.system.goldlineWorld.campaign.useQuery(undefined, {
    staleTime: 15_000,
  });
  const defeat = trpc.system.goldlineWorld.recordGuardianDefeat.useMutation();
  const chapterDone = trpc.system.goldlineWorld.recordCampaignChapterGameCompleted.useMutation();
  const utils = trpc.useUtils();
  const reducedMotion = useReducedMotionFlag();
  const [playing, setPlaying] = useState(false);
  const item = territories.data?.find(row => !row.state.cleared) ?? territories.data?.[0];
  if (!item) return null;
  const guardian = guardianById(item.definition.guardianId);
  const sanctuary = Boolean(campaign.data?.conversationSanctuary);
  const combatQuiet = sanctuary || driving;
  const finale = campaign.data?.campaign.chapters.find(
    chapter =>
      chapter.chapterKind === "guardian_finale" &&
      chapter.territoryId === item.definition.id
  );

  if (playing && !combatQuiet) {
    return (
      <GuardianEncounter
        definition={item.definition}
        state={item.state}
        centroid={{ x: 50, y: 38 }}
        reducedMotion={reducedMotion}
        obligationPresent={false}
        onDefeat={() => {
          if (!item.state.confrontationReady) return;
          defeat.mutate(
            {
              territoryId: item.definition.id,
              guardianId: item.definition.guardianId,
              confrontationReady: true,
            },
            {
              onSettled: () => {
                void utils.system.goldlineWorld.territories.invalidate();
                void utils.system.goldlineWorld.campaign.invalidate();
              },
            }
          );
          if (finale) {
            chapterDone.mutate({ chapterId: finale.stableChapterId });
          }
        }}
        onClose={() => {
          setPlaying(false);
          onEncounterChange?.(false);
        }}
      />
    );
  }

  return (
    <div className="gl-guardian-anchor gl-driver-sky">
      <GuardianActor
        guardianId={guardian.id}
        phase={item.state.cleared ? "ghost" : "idle"}
        clearedGhost={item.state.cleared}
        reducedMotion={reducedMotion}
        scale={item.state.cleared ? 0.45 : 0.85}
      />
      <button
        type="button"
        className="gl-guardian-hit"
        data-testid="goldline-driver-territory-guardian"
        aria-label={`${guardian.name} over ${item.definition.fantasyTitle}. ${challengeSummary({ definition: item.definition, state: item.state })}`}
        onClick={() => {
          if (sanctuary || driving) return;
          setPlaying(true);
          onEncounterChange?.(true);
        }}
      />
    </div>
  );
}
