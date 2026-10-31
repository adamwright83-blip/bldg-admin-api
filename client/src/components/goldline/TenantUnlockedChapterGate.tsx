import type { ReactNode } from "react";
import { trpc } from "@/lib/trpc";

type KingdomStatus = { kingdomId: string; lanternCityStatus: string };

/** The Last Valet chapter opens for a tenant member only once its kingdom is unlocked in Lantern City. */
export function lastValetChapterUnlocked(
  kingdoms: readonly KingdomStatus[] | null | undefined
): boolean {
  return Boolean(
    kingdoms?.some(
      kingdom =>
        kingdom.kingdomId === "kingdom-2-the-last-valet" &&
        kingdom.lanternCityStatus !== "locked"
    )
  );
}

/**
 * The one kingdom-unlock check for /goldline-chapter, shared by the admin-host
 * route table (App.tsx) and the customer host (CustomerHostApp.tsx) so both
 * hosts behave the same. Each host supplies its own way of leaving (`locked`)
 * because the customer host does not route through wouter.
 */
export function TenantUnlockedChapterGate({
  children,
  locked,
}: {
  children: ReactNode;
  locked: ReactNode;
}) {
  const kingdoms = trpc.system.goldlineKingdoms.list.useQuery(undefined, {
    retry: false,
  });
  if (kingdoms.isLoading) {
    return <div style={{ minHeight: "100vh", background: "#fff" }} />;
  }
  if (kingdoms.isError || !lastValetChapterUnlocked(kingdoms.data)) {
    return <>{locked}</>;
  }
  return <>{children}</>;
}
