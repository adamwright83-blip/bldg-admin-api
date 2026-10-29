import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import type { FirstTenCredentials } from "./draftStorage";

/**
 * The crew's reading for this journey: begun once when there is something to read, then followed while it runs.
 * The server does the work and reports it; this only asks.
 */
export function useReading(credentials: FirstTenCredentials | null, enabled: boolean) {
  const begin = trpc.system.firstTenMinutes.understand.useMutation();
  const view = trpc.system.firstTenMinutes.understanding.useQuery(credentials!, {
    enabled: Boolean(credentials) && enabled,
    retry: false,
    refetchInterval: query => (query.state.data?.status === "running" ? 1200 : false),
  });
  const asked = useRef(false);

  useEffect(() => {
    if (!credentials || !enabled || asked.current || !view.data) return;
    if (view.data.status !== "idle") return;
    asked.current = true;
    begin.mutate(credentials, { onSettled: () => void view.refetch() });
  }, [credentials, enabled, view.data, begin, view]);

  return {
    view: view.data ?? null,
    again: () => {
      if (!credentials) return;
      begin.mutate({ ...credentials, again: true }, { onSettled: () => void view.refetch() });
    },
    starting: begin.isPending,
  };
}
