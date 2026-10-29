import { trpc } from "@/lib/trpc";

/**
 * Rook's airmail (SPECIAL DELIVERY) is server-flagged per business. `resolved` turns true once the server has answered
 * (or failed to), so callers that must not race it (the reunion quests) can wait; `memory` is the courtyard's saved
 * discoveries when the flag is on.
 */
export function useSpecialDeliveryFlag(territoryId: string, enabled = true) {
  const q = trpc.system.goldlineWorld.specialDelivery.useQuery({ territoryId }, { staleTime: 30_000, enabled });
  const data = q.data as { enabled?: boolean; memory?: unknown } | undefined;
  return { on: Boolean(data?.enabled), resolved: q.isFetched || q.isError, memory: data?.memory };
}
