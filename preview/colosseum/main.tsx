import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ColosseumBossGate from "@/pages/goldline/ColosseumBossGate";
import ClockheadDuel from "@/pages/goldline/ClockheadDuel";
import { COLOSSEUM_TARGET_IDS } from "@/pages/goldline/colosseumCampaign";
import type { Day1TenDoorsMissionView } from "@/pages/goldline/Day1FieldMission";
import { DAY1_TARGETS, type Day1TargetOutcome } from "@shared/day1TenDoors";
import { connectPreviewMission } from "./trpcStub";
// The global stylesheets every Goldline driver session already has loaded.
import "@/index.css";
import "@/pages/goldline/goldline-overworld.css";

/**
 * Local-only harness. Query parameters:
 *   ?scene=arena|duel   which surface to mount (default arena)
 *   &traced=0..5        how many of the five real targets already have outcomes
 *   &seen=N             pretend this device last saw N traces (plays reveals)
 *   &hold=1             wait for window.__mountColosseum() before mounting,
 *                       so a cinematic can be observed from its first frame
 */
const params = new URLSearchParams(window.location.search);
const MISSION_ID = "preview-day1";
const traced = Math.max(0, Math.min(5, Number(params.get("traced") ?? 0)));
const seen = params.get("seen");
try {
  if (seen != null) window.localStorage.setItem(`goldline:colosseum:seen-traces:${MISSION_ID}`, seen);
  else window.localStorage.removeItem(`goldline:colosseum:seen-traces:${MISSION_ID}`);
} catch {
  // ignore
}

function viewFor(outcomes: Record<string, Day1TargetOutcome>): Day1TenDoorsMissionView {
  const currentTarget = DAY1_TARGETS.find(target => !(target.id in outcomes)) ?? null;
  return {
    missionId: MISSION_ID,
    targets: [...DAY1_TARGETS],
    outcomes,
    currentTarget,
    progressLabel: null,
    visitedCount: Object.keys(outcomes).length,
    totalCount: DAY1_TARGETS.length,
    isComplete: false,
    outcomeCounts: { pitched: 0, couldntReach: 0 },
  };
}

function Harness() {
  const [mounted, setMounted] = useState(!params.has("hold"));
  (window as unknown as { __mountColosseum?: () => void }).__mountColosseum = () => setMounted(true);
  const [outcomes, setOutcomes] = useState<Record<string, Day1TargetOutcome>>(() =>
    Object.fromEntries(COLOSSEUM_TARGET_IDS.slice(0, traced).map(id => [id, "pitched" as const]))
  );
  const [defeated, setDefeated] = useState(false);
  const mission = useMemo(() => viewFor(outcomes), [outcomes]);
  connectPreviewMission(mission, view => setOutcomes({ ...view.outcomes }));

  if (!mounted) return null;
  if (defeated) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", font: "600 20px Fraunces, serif", color: "#1d2433" }}>
        onDefeated() called once → controller would persist the Wayward unlock.
      </div>
    );
  }
  if (params.get("scene") === "duel") {
    return <ClockheadDuel onDefeated={() => setDefeated(true)} />;
  }
  return (
    <ColosseumBossGate
      mission={mission}
      isRecordingOutcome={false}
      onRecordOutcome={() => undefined}
      onBossDefeated={() => setDefeated(true)}
    />
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
