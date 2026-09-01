import { trpc } from "@/lib/trpc";
import { CampaignGoldLine } from "./CampaignGoldLine";
import { CampaignHudConnected } from "./CampaignHud";
import "./goldline-campaign.css";
import type { CityWorldEntity } from "../../../../server/goldlineWorld/cityWorldService";

export function CampaignWorldLayer({
  entities,
  googleVisible,
}: {
  entities: readonly CityWorldEntity[];
  googleVisible: boolean;
}) {
  const campaign = trpc.system.goldlineWorld.campaign.useQuery(undefined, {
    staleTime: 15_000,
  });
  return (
    <>
      <CampaignGoldLine
        campaign={campaign.data?.campaign ?? null}
        entities={entities}
        googleVisible={googleVisible}
      />
    </>
  );
}

export function CampaignChrome() {
  return <CampaignHudConnected />;
}

export function CampaignOverlandThread() {
  const campaign = trpc.system.goldlineWorld.campaign.useQuery(undefined, {
    staleTime: 15_000,
  });
  const chapters = campaign.data?.campaign.chapters ?? [];
  if (!chapters.length) return null;
  const currentIndex = Math.max(
    0,
    chapters.findIndex(item => item.stableChapterId === campaign.data?.campaign.currentChapterId)
  );
  const points = chapters.map((_, index) => {
    const x = 8 + (index / Math.max(1, chapters.length - 1)) * 84;
    const y = 40 + Math.sin(index) * 18;
    return `${x},${y}`;
  });
  return (
    <svg className="gl-campaign-overland-thread" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline points={points.join(" ")} />
      {chapters.map((chapter, index) => (
        <circle
          key={chapter.stableChapterId}
          className={`gl-campaign-knot${chapter.hardAnchor ? " is-hard" : ""}${index === currentIndex ? " is-current" : ""}`}
          cx={8 + (index / Math.max(1, chapters.length - 1)) * 84}
          cy={40 + Math.sin(index) * 18}
          r={chapter.hardAnchor ? 3.2 : 2.2}
        />
      ))}
    </svg>
  );
}

export function CampaignChronicleList() {
  const history = trpc.system.goldlineWorld.campaigns.useQuery(undefined, {
    staleTime: 30_000,
  });
  const rows = history.data ?? [];
  if (!rows.length) return null;
  return (
    <section className="gl-campaign-history" aria-label="Past adventures">
      <h2>Etched adventures</h2>
      <ol>
        {rows.map(item => (
          <li key={item.id}>
            <strong>{item.title}</strong>
            <span>
              {" "}
              · {item.businessDate} · rev {item.revision}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
