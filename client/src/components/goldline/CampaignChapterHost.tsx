import type { GameplayBinding } from "@shared/goldlineCampaign";
import {
  arcadePressureAllowed,
  campaignArrivalPhase,
  campaignWorldRemainsPlayable,
  currentChapterHost,
  deadAirBridgeAllowed,
  hostForBinding,
} from "@shared/goldlineCampaignRuntime";
import { trpc } from "@/lib/trpc";
import "./goldline-campaign.css";

const HOST_COPY: Record<GameplayBinding, string> = {
  expedition: "Continue the existing expedition",
  authoritative_visit_route: "Follow the frozen visit route",
  local_target_run: "Continue the target run",
  action_grammar: "Play this as the assigned action",
  encounter: "A fictional encounter sits between real beats",
  recovery: "Recover the dormant relationship",
  territory_push: "The territory is already in this world",
  guardian_finale: "The Guardian is derived-ready",
  field_journal: "Capture evidence in the Field Journal",
  direct_real_action: "The real action is the climax",
  world_exploration: "The city stays playable",
};

export function CampaignChapterHost({
  driving = false,
  atDestination = false,
  onHostCurrentChapter,
}: {
  driving?: boolean;
  atDestination?: boolean;
  onHostCurrentChapter?: (binding: GameplayBinding) => void;
}) {
  const campaign = trpc.system.goldlineWorld.campaign.useQuery(undefined, {
    staleTime: 15_000,
  });
  const presentation = campaign.data;
  if (!presentation) return null;
  const hosted = currentChapterHost(presentation.campaign);
  const playable = campaignWorldRemainsPlayable(presentation.campaign.status);
  const arrival = campaignArrivalPhase({
    driving,
    atDestination,
    status: presentation.campaign.status,
  });
  const arcade = hosted
    ? arcadePressureAllowed({
        driving,
        conversationSanctuary: presentation.conversationSanctuary,
        binding: hosted.binding,
      })
    : false;
  const deadAir = deadAirBridgeAllowed({
    pacing: presentation.pacing,
    driving,
    conversationSanctuary: presentation.conversationSanctuary,
  });
  const invokesExistingSystem =
    hosted &&
    hosted.binding !== "world_exploration" &&
    hosted.binding !== "territory_push" &&
    hosted.binding !== "guardian_finale";

  return (
    <div
      className={`gl-campaign-host${driving ? " is-driving" : ""}${arrival === "focal" ? " is-arrival" : ""}`}
      data-testid="goldline-campaign-host"
      data-binding={hosted?.binding ?? "none"}
      data-host={hosted ? hostForBinding(hosted.binding) : "none"}
      data-world-playable={playable ? "true" : "false"}
      data-driving={driving ? "true" : "false"}
      data-arrival={arrival}
      data-arcade={arcade ? "true" : "false"}
    >
      {arrival === "focal" ? (
        <p data-testid="goldline-campaign-arrival">
          The city focuses this place. The real action is the climax, not a break from the game.
        </p>
      ) : null}
      {driving ? (
        <p data-testid="goldline-campaign-driving">The campaign stays in the sky. No arcade while moving.</p>
      ) : null}
      {deadAir && !driving ? (
        <p data-testid="goldline-campaign-dead-air">The world holds between beats. Nothing extra was invented.</p>
      ) : null}
      {presentation.campaign.endingTreatment && presentation.campaign.status === "completed" ? (
        <p data-testid="goldline-campaign-ending">{presentation.campaign.endingTreatment}</p>
      ) : null}
      {invokesExistingSystem && onHostCurrentChapter && !driving ? (
        <button
          type="button"
          className="gl-campaign-host-action"
          data-testid="goldline-campaign-host-action"
          onClick={() => onHostCurrentChapter(hosted.binding)}
        >
          {HOST_COPY[hosted.binding]}
        </button>
      ) : hosted ? (
        <p>{HOST_COPY[hosted.binding]}</p>
      ) : playable ? (
        <p>The city is playable. The campaign is not a lock screen.</p>
      ) : null}
    </div>
  );
}
