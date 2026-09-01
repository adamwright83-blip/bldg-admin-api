import { useState } from "react";
import { guardianById } from "@shared/goldlineGuardians";
import { challengeSummary } from "@shared/goldlineTerritories";
import { trpc } from "@/lib/trpc";
import { GuardianActor } from "@/components/goldline/GuardianActor";
import { GuardianEncounter } from "@/components/goldline/GuardianEncounter";
import { useReducedMotionFlag } from "@/components/goldline/TerritoryWorldLayer";
import "@/components/goldline/goldline-territories.css";

export function DriverTerritorySky({
  onEncounterChange,
}: {
  onEncounterChange?: (active: boolean) => void;
}) {
  const territories = trpc.system.goldlineWorld.territories.useQuery(undefined, {
    staleTime: 15_000,
  });
  const defeat = trpc.system.goldlineWorld.recordGuardianDefeat.useMutation();
  const utils = trpc.useUtils();
  const reducedMotion = useReducedMotionFlag();
  const [playing, setPlaying] = useState(false);
  const item = territories.data?.find(row => !row.state.cleared) ?? territories.data?.[0];
  if (!item) return null;
  const guardian = guardianById(item.definition.guardianId);

  if (playing) {
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
            { onSettled: () => void utils.system.goldlineWorld.territories.invalidate() }
          );
        }}
        onClose={() => {
          setPlaying(false);
          onEncounterChange?.(false);
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="gl-guardian"
      style={{ left: "72%", top: "10%", position: "absolute", zIndex: 8 }}
      data-testid="goldline-driver-territory-guardian"
      aria-label={`${guardian.name} over ${item.definition.fantasyTitle}. ${challengeSummary({ definition: item.definition, state: item.state })}`}
      onClick={() => {
        setPlaying(true);
        onEncounterChange?.(true);
      }}
    >
      <GuardianActor
        guardianId={guardian.id}
        phase={item.state.cleared ? "ghost" : "idle"}
        clearedGhost={item.state.cleared}
        reducedMotion={reducedMotion}
        scale={item.state.cleared ? 0.45 : 0.85}
      />
    </button>
  );
}
