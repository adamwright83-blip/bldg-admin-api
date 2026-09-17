/**
 * Mobile Campaign Run mission overlay. Presentation only: every image comes
 * from `presentCampaignRunArt`, which refuses completion art unless the
 * run's derived progress is actually complete.
 */
import { useEffect } from "react";
import type { CampaignRunPresentedArt } from "../../../../shared/fictionPackVisuals";

export type CampaignRunMissionCopy = {
  role: string;
  briefing: string;
  proofFraming: string;
  latestBeatText: string | null;
  echoText: string | null;
  victoryText: string | null;
  qualified: number;
  total: number;
};

export type CampaignRunMissionProps = {
  art: CampaignRunPresentedArt;
  copy: CampaignRunMissionCopy;
  onClose: () => void;
  onEnterField: () => void;
  onDismissComms: () => void;
};

function ScenePreload({ srcs }: { srcs: readonly string[] }) {
  useEffect(() => {
    for (const src of srcs) {
      const image = new Image();
      image.src = src;
    }
  }, [srcs]);
  return null;
}

export default function CampaignRunMission(props: CampaignRunMissionProps) {
  const { art, copy } = props;
  const progressLabel = `${copy.qualified} / ${copy.total}`;

  return (
    <section
      className="bc-mission"
      data-testid="bio-containment-mission"
      data-scene={art.scene}
      data-pack-id={art.packId}
      aria-label="BIO CONTAINMENT"
    >
      <ScenePreload srcs={art.preloadSrcs} />
      <img
        className="bc-mission-scene"
        data-testid="bio-containment-scene"
        src={art.sceneSrc}
        alt=""
        draggable={false}
      />

      <header className="bc-mission-hud">
        <small>BIO CONTAINMENT</small>
        <b>{copy.role.toUpperCase()}</b>
        <span data-testid="bio-containment-progress">{progressLabel}</span>
        <button
          type="button"
          className="bc-mission-close"
          onClick={props.onClose}
          aria-label="Close mission"
        >
          CLOSE
        </button>
      </header>

      {art.scene === "briefing" ? (
        <div className="bc-mission-panel" data-testid="bio-containment-briefing">
          <p>{copy.briefing}</p>
          <p>{copy.proofFraming}</p>
          <button type="button" onClick={props.onEnterField}>
            ENTER FIELD
          </button>
        </div>
      ) : null}

      {art.scene === "field" ? (
        <div className="bc-mission-field" data-testid="bio-containment-field">
          <p className="bc-mission-echo">{copy.echoText ?? copy.proofFraming}</p>
          <ol className="bc-mission-nodes" aria-label="Detector nodes">
            {art.nodes.map(node => (
              <li
                key={node.slotId}
                data-node-state={node.state}
                data-testid={`bio-containment-node-${node.targetId}`}
              >
                <img src={node.src} alt="" draggable={false} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {art.scene === "antagonist_comms" ? (
        <div
          className="bc-mission-panel"
          data-testid="bio-containment-clockhead-comms"
        >
          <p>{copy.latestBeatText}</p>
          <button type="button" onClick={props.onDismissComms}>
            RETURN TO FIELD
          </button>
        </div>
      ) : null}

      {art.scene === "complete" ? (
        <div
          className="bc-mission-panel"
          data-testid="bio-containment-complete"
        >
          <p>{copy.victoryText}</p>
        </div>
      ) : null}
    </section>
  );
}
