/**
 * Loads the authoritative Campaign Run projection and renders BIO CONTAINMENT
 * art from that projection. Visual transitions follow query updates — never
 * a local counter, timer, or tap-to-complete shortcut.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  presentCampaignRunArt,
  resolveFictionPackVisuals,
  type CampaignRunVisualSurface,
} from "../../../../shared/fictionPackVisuals";
import CampaignRunMission from "./CampaignRunMission";
import "./CampaignRunMission.css";

export default function CampaignRunMissionHost(props: {
  campaignRunId: string;
  onClose: () => void;
}) {
  const projection = trpc.system.campaignRuns.projection.useQuery(
    { campaignRunId: props.campaignRunId },
    { refetchOnWindowFocus: true }
  );
  const [fieldEntered, setFieldEntered] = useState(false);
  const [acknowledgedBeatId, setAcknowledgedBeatId] = useState<string | null>(
    null
  );
  const seenBeatsRef = useRef<string | null>(null);

  const run = projection.data?.run ?? null;
  const progress = projection.data?.progress ?? null;
  const fiction = projection.data?.fiction ?? null;

  const midMissionBeats = useMemo(
    () => (progress?.complete ? [] : (fiction?.reachedBeats ?? [])),
    [progress?.complete, fiction?.reachedBeats]
  );
  const latestMidBeat = midMissionBeats[midMissionBeats.length - 1] ?? null;

  useEffect(() => {
    if (!latestMidBeat) return;
    if (seenBeatsRef.current == null) {
      seenBeatsRef.current = latestMidBeat.id;
      setAcknowledgedBeatId(latestMidBeat.id);
      return;
    }
    if (seenBeatsRef.current !== latestMidBeat.id) {
      seenBeatsRef.current = latestMidBeat.id;
      setAcknowledgedBeatId(null);
    }
  }, [latestMidBeat]);

  if (projection.isLoading || projection.data === undefined) {
    const visuals = resolveFictionPackVisuals("bio_containment");
    if (!visuals) return null;
    return (
      <section
        className="bc-mission"
        data-testid="bio-containment-mission-loading"
        aria-label="BIO CONTAINMENT"
      >
        <img className="bc-mission-scene" src={visuals.missionHero} alt="" />
      </section>
    );
  }
  if (!run || !progress) return null;
  if (run.fictionPackId !== "bio_containment") return null;

  const antagonistCommsActive =
    !progress.complete &&
    latestMidBeat != null &&
    acknowledgedBeatId !== latestMidBeat.id;

  const surface: CampaignRunVisualSurface = progress.complete
    ? "complete"
    : antagonistCommsActive
      ? "antagonist_comms"
      : fieldEntered || progress.qualified > 0
        ? "field"
        : "briefing";

  const art = presentCampaignRunArt({
    fictionPackId: run.fictionPackId,
    runStatus: run.status,
    progressComplete: progress.complete,
    slots: progress.slots,
    midMissionBeatIds: midMissionBeats.map(beat => beat.id),
    antagonistCommsActive,
    fieldEntered: fieldEntered || progress.qualified > 0,
    surface,
  });
  if (!art) return null;

  return (
    <CampaignRunMission
      art={art}
      copy={{
        role: fiction?.role ?? "field agent",
        briefing: fiction?.briefing ?? "",
        proofFraming: fiction?.proofFraming ?? "",
        latestBeatText: latestMidBeat?.text ?? null,
        echoText: fiction?.incomplete?.text ?? null,
        victoryText: fiction?.completion?.victory ?? null,
        qualified: progress.qualified,
        total: progress.total,
      }}
      onClose={props.onClose}
      onEnterField={() => setFieldEntered(true)}
      onDismissComms={() => {
        if (latestMidBeat) setAcknowledgedBeatId(latestMidBeat.id);
      }}
    />
  );
}
