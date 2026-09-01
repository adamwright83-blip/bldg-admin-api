import { projectLatLngToLanternAtlas } from "@shared/lanternCity";
import type { CampaignInstance } from "@shared/goldlineCampaign";
import type { CityWorldEntity } from "../../../../server/goldlineWorld/cityWorldService";

function chapterPoint(
  campaign: CampaignInstance,
  chapterId: string,
  entities: readonly CityWorldEntity[]
): { x: number; y: number; hard: boolean; current: boolean; completed: boolean } | null {
  const chapter = campaign.chapters.find(item => item.stableChapterId === chapterId);
  if (!chapter) return null;
  for (const anchor of chapter.physicalAnchors) {
    if (typeof anchor.latitude === "number" && typeof anchor.longitude === "number") {
      const atlas = projectLatLngToLanternAtlas({
        latitude: anchor.latitude,
        longitude: anchor.longitude,
      });
      if (!atlas.outOfBounds) {
        return {
          x: atlas.x,
          y: atlas.y,
          hard: chapter.hardAnchor,
          current: campaign.currentChapterId === chapter.stableChapterId,
          completed: campaign.completedChapterIds.includes(chapter.stableChapterId),
        };
      }
    }
    if (!anchor.physicalEntityId) continue;
    const entity = entities.find(row => row.id === anchor.physicalEntityId);
    const latitude = entity?.location?.latitude;
    const longitude = entity?.location?.longitude;
    if (typeof latitude !== "number" || typeof longitude !== "number") continue;
    const atlas = projectLatLngToLanternAtlas({ latitude, longitude });
    if (atlas.outOfBounds) continue;
    return {
      x: atlas.x,
      y: atlas.y,
      hard: chapter.hardAnchor,
      current: campaign.currentChapterId === chapter.stableChapterId,
      completed: campaign.completedChapterIds.includes(chapter.stableChapterId),
    };
  }
  return null;
}

export function CampaignGoldLine({
  campaign,
  entities,
  googleVisible,
}: {
  campaign: CampaignInstance | null;
  entities: readonly CityWorldEntity[];
  googleVisible: boolean;
}) {
  if (!campaign || googleVisible) return null;
  const points = campaign.chapters
    .map(chapter => chapterPoint(campaign, chapter.stableChapterId, entities))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (points.length === 0) return null;
  const path = points.map(point => `${point.x},${point.y}`).join(" ");

  return (
    <svg className="gl-campaign-line" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
      {points.length > 1 ? (
        <polyline
          className="gl-campaign-line-path"
          points={path}
          fill="none"
        />
      ) : null}
      {points.map((point, index) => (
        <circle
          key={`${point.x}-${point.y}-${index}`}
          className={`gl-campaign-knot${point.hard ? " is-hard" : ""}${point.current ? " is-current" : ""}${point.completed ? " is-complete" : ""}`}
          cx={point.x}
          cy={point.y}
          r={point.hard ? 1.8 : 1.2}
        />
      ))}
    </svg>
  );
}
