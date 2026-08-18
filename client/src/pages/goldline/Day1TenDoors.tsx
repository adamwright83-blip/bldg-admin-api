import ColosseumBossGate from "./ColosseumBossGate";
import type { Day1TargetOutcome } from "../../../../shared/day1TenDoors";
import type { Day1TenDoorsMissionView } from "./Day1FieldMission";

export type { Day1TenDoorsMissionView } from "./Day1FieldMission";

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
  return (
    <ColosseumBossGate
      mission={mission}
      isRecordingOutcome={isRecordingOutcome}
      onRecordOutcome={onRecordOutcome}
      onBossDefeated={onDismiss}
    />
  );
}
