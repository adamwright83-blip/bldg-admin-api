import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const visualTestMode = import.meta.env.DEV && import.meta.env.VITE_ADMIN_VISUAL_TEST === "1";
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: !visualTestMode,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    return {
      user: visualTestMode ? { openId: "visual-test", name: "Admin Preview", email: null, role: "admin" as const } : meQuery.data ?? null,
      loading: visualTestMode ? false : meQuery.isLoading || logoutMutation.isPending,
      error: visualTestMode ? null : meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: visualTestMode || Boolean(meQuery.data),
    };
  }, [
    visualTestMode,
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    const target = redirectPath || getLoginUrl();
    if (!target) return;
    try {
      const current = new URL(window.location.href);
      const next = new URL(target, window.location.origin);
      if (current.href === next.href) return;
      if (next.origin === current.origin && next.pathname === current.pathname) return;
      if (next.origin === current.origin && next.pathname === "/") return;
      window.location.href = next.toString();
    } catch {
      return;
    }
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
