/**
 * In-memory stand-in for `@/lib/trpc`, used ONLY by the standalone Colosseum
 * preview (vite.colosseum-preview.config.ts). It lets the real, unmodified
 * Day1FieldMission record outcomes into local preview state so the arena's
 * read-only projection can be watched reacting. It never touches a network.
 */
import type { Day1TenDoorsMissionView } from "@/pages/goldline/Day1FieldMission";

type Outcome = "pitched" | "couldnt_reach";

let current: Day1TenDoorsMissionView | null = null;
let publish: ((view: Day1TenDoorsMissionView) => void) | null = null;

export function connectPreviewMission(
  view: Day1TenDoorsMissionView,
  onChange: (view: Day1TenDoorsMissionView) => void
) {
  current = view;
  publish = onChange;
}

function withOutcome(targetId: string, outcome: Outcome): Day1TenDoorsMissionView {
  if (!current) throw new Error("preview mission not connected");
  const outcomes = { ...current.outcomes, [targetId]: outcome };
  return { ...current, outcomes, visitedCount: Object.keys(outcomes).length };
}

const mutation = <Input, Output>(run: (input: Input) => Output) => ({
  useMutation: () => ({
    isPending: false,
    mutateAsync: async (input: Input) => {
      await new Promise(resolve => setTimeout(resolve, 180));
      return run(input);
    },
  }),
});

export const trpc = {
  useUtils: () => ({
    system: {
      day1TenDoors: {
        current: {
          setData: (_key: unknown, view: Day1TenDoorsMissionView) => {
            current = view;
            publish?.(view);
          },
        },
      },
    },
  }),
  system: {
    day1TenDoors: {
      recordEvidence: mutation((_input: { targetId: string }) => current!),
      recordOutcome: mutation((input: { targetId: string; outcome: Outcome }) =>
        withOutcome(input.targetId, input.outcome)
      ),
    },
  },
};
