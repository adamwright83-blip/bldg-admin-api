import { useEffect } from "react";
import ColosseumBossGate from "./ColosseumBossGate";
import type { Day1TargetOutcome } from "../../../../shared/day1TenDoors";
import type { Day1TenDoorsMissionView } from "./Day1FieldMission";

export type { Day1TenDoorsMissionView } from "./Day1FieldMission";

const TRAILBLAZER_DIRECTIONAL_BASE =
  "/assets/goldline/characters/trailblazer/directional";
const TRAILBLAZER_DIRECTIONS = ["front", "back", "left", "right"] as const;
const COLOSSEUM_PREWARM_URLS = TRAILBLAZER_DIRECTIONS.flatMap(direction => [
  `${TRAILBLAZER_DIRECTIONAL_BASE}/idle-${direction}.webp`,
  ...Array.from(
    { length: 5 },
    (_, index) =>
      `${TRAILBLAZER_DIRECTIONAL_BASE}/walk-${direction}-${String(index + 1).padStart(2, "0")}.webp`
  ),
]);

/**
 * The Day 1 production gate is now the Colosseum opening act.
 * The existing controller can stay untouched: its onDismiss callback already
 * persists the fictional unlock and then exposes the broader Goldline world.
 */
export default function Day1TenDoors({
  mission,
  isRecordingOutcome,
  onRecordOutcome,
  onDismiss,
}: {
  mission: Day1TenDoorsMissionView;
  isRecordingOutcome: boolean;
  onRecordOutcome: (targetId: string, outcome: Day1TargetOutcome) => void;
  onDismiss: () => void;
}) {
  // Cold phones should not discover animation frames one-by-one while the
  // player is already moving. Prewarm the tiny directional set as soon as the
  // gate mounts; this changes presentation only and carries no game truth.
  useEffect(() => {
    const images = COLOSSEUM_PREWARM_URLS.map(src => {
      const image = new Image();
      image.decoding = "async";
      image.src = src;
      return image;
    });
    return () => {
      for (const image of images) image.src = "";
    };
  }, []);

  return (
    <ColosseumBossGate
      mission={mission}
      isRecordingOutcome={isRecordingOutcome}
      onRecordOutcome={onRecordOutcome}
      onBossDefeated={onDismiss}
    />
  );
}
