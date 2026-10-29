/**
 * In-memory stand-in for `@/lib/trpc`, used ONLY by the standalone Special Delivery preview
 * (vite.special-delivery-preview.config.ts). Every query resolves to "no data", every mutation to a no-op, so the
 * real Silver Lake component runs with its synthetic neighbours and nothing can reach a network. The courtyard's
 * own memory and the correspondence desk's fixture are served by `previewState` below, never by a server.
 */
import { useSyncExternalStore } from "react";

type Store = Record<string, unknown>;
const state: Store = {};
const listeners = new Set<() => void>();
let version = 0;

export const previewState = {
  get<T>(key: string): T | undefined {
    return state[key] as T | undefined;
  },
  set(key: string, value: unknown) {
    state[key] = value;
    version++;
    listeners.forEach(l => l());
  },
};

const queryHandlers: Record<string, (input: unknown) => unknown> = {};
const mutationHandlers: Record<string, (input: unknown) => unknown> = {};

/** Preview-only: serve a procedure from local state (path like "system.goldlineWorld.specialDeliveryMemory"). */
export function serveQuery(path: string, run: (input: unknown) => unknown) {
  queryHandlers[path] = run;
}
export function serveMutation(path: string, run: (input: unknown) => unknown) {
  mutationHandlers[path] = run;
}

function useVersion() {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version
  );
}

function procedure(path: string): unknown {
  return new Proxy(() => undefined, {
    get(_t, prop: string) {
      if (prop === "useQuery") {
        return (input: unknown, opts?: { enabled?: boolean }) => {
          useVersion();
          const run = queryHandlers[path];
          const enabled = opts?.enabled !== false;
          const data = run && enabled ? run(input) : undefined;
          return {
            data,
            isLoading: false,
            isFetching: false,
            isFetched: true,
            isSuccess: true,
            isError: false,
            error: null,
            refetch: async () => ({ data }),
          };
        };
      }
      if (prop === "useMutation") {
        return () => ({
          isPending: false,
          mutate: (input: unknown) => void mutationHandlers[path]?.(input),
          mutateAsync: async (input: unknown) => {
            await new Promise(r => setTimeout(r, 120));
            const run = mutationHandlers[path];
            if (!run) return undefined;
            return run(input);
          },
        });
      }
      if (prop === "invalidate" || prop === "refetch" || prop === "cancel")
        return async () => undefined;
      if (prop === "setData" || prop === "reset") return () => undefined;
      if (prop === "getData") return () => undefined;
      if (prop === "fetch")
        return async (input: unknown) => queryHandlers[path]?.(input);
      return procedure(path ? `${path}.${prop}` : prop);
    },
  });
}

export const trpc = new Proxy(
  {},
  {
    get(_t, prop: string) {
      if (prop === "useUtils" || prop === "useContext")
        return () => procedure("");
      if (prop === "Provider")
        return ({ children }: { children: unknown }) => children;
      return procedure(prop);
    },
  }
) as never;
