import type { CampaignPresentation } from "@shared/goldlineCampaign";
import { trpc } from "@/lib/trpc";
import "./goldline-campaign.css";

function chapterLabel(kind: string) {
  return kind.replaceAll("_", " ");
}

export function CampaignHud({
  presentation,
  compact = false,
  onChooseBranch,
}: {
  presentation: CampaignPresentation | null | undefined;
  compact?: boolean;
  onChooseBranch?: (chapterId: string) => void;
}) {
  if (!presentation) return null;
  const campaign = presentation.campaign;
  const current = campaign.chapters.find(item => item.stableChapterId === campaign.currentChapterId);
  const nextHard = campaign.chapters.find(
    item =>
      item.hardAnchor &&
      !campaign.completedChapterIds.includes(item.stableChapterId) &&
      item.stableChapterId !== campaign.currentChapterId
  );
  const optional = campaign.chapters.find(
    item =>
      !item.required &&
      !campaign.completedChapterIds.includes(item.stableChapterId) &&
      item.stableChapterId !== campaign.currentChapterId
  );

  return (
    <aside
      className={`gl-campaign-hud${compact ? " is-compact" : ""}${presentation.conversationSanctuary ? " is-sanctuary" : ""}`}
      aria-live="polite"
      data-testid="goldline-campaign-hud"
      data-campaign-id={campaign.id}
      data-revision={campaign.revision}
      data-pacing={presentation.pacing}
    >
      <strong>{campaign.title}</strong>
      {current ? (
        <p>
          Now: {chapterLabel(current.chapterKind)}
          {current.hardAnchor ? " · hard anchor" : ""}
        </p>
      ) : (
        <p>{campaign.status === "quiet" ? "The city is playable. Nothing is required." : "Between acts."}</p>
      )}
      {nextHard ? <p className="gl-campaign-next">Next hard: {chapterLabel(nextHard.chapterKind)}</p> : null}
      {optional && onChooseBranch ? (
        <button
          type="button"
          className="gl-campaign-branch"
          data-testid="goldline-campaign-branch"
          onClick={() => onChooseBranch(optional.stableChapterId)}
        >
          Optional branch
        </button>
      ) : optional ? (
        <p>Optional branch available</p>
      ) : null}
      {presentation.revisionExplanation ? (
        <p className="gl-campaign-why" data-testid="goldline-campaign-revision-why">
          {presentation.revisionExplanation}
        </p>
      ) : null}
    </aside>
  );
}

export function CampaignHudConnected({ compact = false }: { compact?: boolean }) {
  const campaign = trpc.system.goldlineWorld.campaign.useQuery(undefined, {
    staleTime: 15_000,
  });
  const choose = trpc.system.goldlineWorld.chooseCampaignBranch.useMutation();
  const utils = trpc.useUtils();
  return (
    <CampaignHud
      compact={compact}
      presentation={campaign.data}
      onChooseBranch={chapterId =>
        choose.mutate(
          { chapterId },
          { onSettled: () => void utils.system.goldlineWorld.campaign.invalidate() }
        )
      }
    />
  );
}
