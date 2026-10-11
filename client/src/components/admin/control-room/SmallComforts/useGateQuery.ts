import { trpc } from "@/lib/trpc";
import type { GateQueryState } from "./logic/gate";

/**
 * The one read the game makes. `hiddenGame.eligibility` is a query with no
 * mutation beside it: the server records an unlock from business records the
 * client cannot touch. The Lantern City tile and the game share this key, so
 * they cannot disagree.
 */
export function useGateQuery(options: { enabled?: boolean } = {}): GateQueryState {
  const query = trpc.system.hiddenGame.eligibility.useQuery(undefined, {
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    retry: 1,
    enabled: options.enabled ?? true,
  });
  if (query.isError) return { status: "error" };
  if (!query.data) return { status: "loading" };
  return { status: "success", data: query.data };
}
