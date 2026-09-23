import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { loadWaywardProgress, saveWaywardProgress, type WaywardProgress } from "./waywardProgress";
import { rookAboard, type WaywardRookSource } from "../wayward/waywardParty";
import type { WaywardProgressPatch } from "../wayward/WaywardVoyage";

const WaywardVoyage = lazy(() => import("../wayward/WaywardVoyage"));

/**
 * The Wayward stage mount. Production mounts pass no `rookSource` until the
 * server progression read is wired in, so the voyage fails closed: Trailblazer
 * can cross the broken span, and the outer tether stays sealed.
 *
 * `fixture` exists only under the compile-time Goldline test harness
 * (Driver.tsx). There, `?waywardRook=preview` is the explicit testing seam that
 * puts Rook aboard, and `?waywardStart=deck|span|sail` picks where to begin.
 */
export default function WaywardTetheredDeck({
  playerIdentity,
  fixture = false,
  rookSource,
  onReturn,
}: {
  playerIdentity: string | null;
  fixture?: boolean;
  rookSource?: WaywardRookSource | null;
  onReturn: () => void;
}) {
  const params = useMemo(() => (fixture ? new URLSearchParams(window.location.search) : null), [fixture]);
  const source: WaywardRookSource | null =
    rookSource ?? (params?.get("waywardRook") === "preview" ? { kind: "preview", reason: "goldline-test-harness" } : null);
  const [progress, setProgress] = useState<WaywardProgress>(() => {
    const stored = loadWaywardProgress(playerIdentity);
    return fixture ? { ...stored, unlocked: true } : stored;
  });

  const start = useMemo<"deck" | "span" | "sail">(() => {
    const asked = params?.get("waywardStart");
    if (asked === "deck" || asked === "span" || asked === "sail") return asked;
    if (progress.tetherAwake) return "sail";
    if (progress.spanCrossed) return "span";
    return "deck";
    // The starting beat is chosen once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onProgress = useCallback(
    (patch: WaywardProgressPatch) => {
      setProgress(current => {
        const next: WaywardProgress = {
          ...current,
          ...patch,
          relic: patch.relic ?? current.relic,
          // The old guardian duel is gone; crossing the span is what clears the way now.
          guardianCleared: current.guardianCleared || Boolean(patch.spanCrossed),
        };
        if (!fixture) saveWaywardProgress(playerIdentity, next);
        return next;
      });
    },
    [fixture, playerIdentity]
  );

  return (
    <Suspense fallback={<div style={{ minHeight: "100dvh", background: "#05080c" }} />}>
      <WaywardVoyage
        rookAboard={rookAboard(source)}
        start={start}
        cacheCollected={progress.cacheCollected}
        exposeTestApi={fixture || import.meta.env.DEV}
        onProgress={onProgress}
        onReturn={onReturn}
      />
    </Suspense>
  );
}
