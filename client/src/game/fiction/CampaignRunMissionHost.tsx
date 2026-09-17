/**
 * Loads the authoritative Campaign Run projection and renders BIO CONTAINMENT
 * art from that projection. Visual transitions follow query updates — never
 * a local counter, timer, or tap-to-complete shortcut.
 *
 * Field-entry and Clockhead-beat dismissal are presentation metadata in
 * localStorage (same pattern as fiction assignments). They do not create
 * campaign-run progress. Mounting is not acknowledgement.
 */
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  presentCampaignRunArt,
  resolveCampaignRunHostSurface,
  resolveFictionPackVisuals,
} from "../../../../shared/fictionPackVisuals";
import {
  acknowledgeCampaignRunBeat,
  loadCampaignRunPresentation,
  markCampaignRunFieldEntered,
} from "./campaignRunPresentationStorage";
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
  const [fieldEntered, setFieldEntered] = useState(
    () => loadCampaignRunPresentation(props.campaignRunId).fieldEntered
  );
  const [acknowledgedBeatId, setAcknowledgedBeatId] = useState<string | null>(
    () => loadCampaignRunPresentation(props.campaignRunId).acknowledgedBeatId
  );

  useEffect(() => {
    const stored = loadCampaignRunPresentation(props.campaignRunId);
    setFieldEntered(stored.fieldEntered);
    setAcknowledgedBeatId(stored.acknowledgedBeatId);
  }, [props.campaignRunId]);

  const run = projection.data?.run ?? null;
  const progress = projection.data?.progress ?? null;
  const fiction = projection.data?.fiction ?? null;

  const midMissionBeats = useMemo(
    () => (progress?.complete ? [] : (fiction?.reachedBeats ?? [])),
    [progress?.complete, fiction?.reachedBeats]
  );
  const latestMidBeat = midMissionBeats[midMissionBeats.length - 1] ?? null;

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

  const surface = resolveCampaignRunHostSurface({
    progressComplete: progress.complete,
    latestMidBeatId: latestMidBeat?.id ?? null,
    acknowledgedBeatId,
    fieldEntered,
    qualifiedCount: progress.qualified,
  });

  const art = presentCampaignRunArt({
    fictionPackId: run.fictionPackId,
    runStatus: run.status,
    progressComplete: progress.complete,
    slots: progress.slots,
    midMissionBeatIds: midMissionBeats.map(beat => beat.id),
    antagonistCommsActive: surface === "antagonist_comms",
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
      onEnterField={() => {
        setFieldEntered(true);
        markCampaignRunFieldEntered(props.campaignRunId);
      }}
      onDismissComms={() => {
        if (!latestMidBeat) return;
        setAcknowledgedBeatId(latestMidBeat.id);
        acknowledgeCampaignRunBeat(props.campaignRunId, latestMidBeat.id);
      }}
    />
  );
}
