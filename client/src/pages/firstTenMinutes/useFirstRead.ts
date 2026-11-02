import { trpc } from "@/lib/trpc";
import type { FirstReadView } from "@shared/firstTenMinutes";
import type { FirstTenCredentials } from "./draftStorage";

/**
 * The first read's lines for this journey (server/firstTenMinutes/firstRead). The server starts it the moment Google
 * sends the person back; this only asks, while it is still being written and for a little past its deadline.
 */
export function useFirstRead(credentials: FirstTenCredentials | null, enabled: boolean): FirstReadView | null {
  const view = trpc.system.firstTenMinutes.firstRead.useQuery(credentials!, {
    enabled: Boolean(credentials) && enabled,
    retry: false,
    refetchInterval: query => {
      const data = query.state.data;
      return data?.status === "running" && data.elapsedMs < data.deadlineMs + 15_000 ? 1500 : false;
    },
  });
  return view.data ?? null;
}

/**
 * Whether the crew should wait for the first read before stepping in: while its lines may still come (up to the
 * deadline), and while they are being read. Never once the journey has moved past the reading.
 */
export function firstReadHolds(view: FirstReadView | null, read: boolean): boolean {
  if (!view) return false;
  if (view.status === "running") return view.elapsedMs < view.deadlineMs;
  return view.status === "revealed" && view.lines.length > 0 && !read;
}
