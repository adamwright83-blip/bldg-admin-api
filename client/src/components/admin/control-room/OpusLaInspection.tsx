/**
 * Opus LA tower inspection — real Opus LA art, real contributor data.
 *
 * Reached from Opus LA's marker in both the live Lantern City scene
 * (LanternCitySceneV6/LanternCityScene.tsx) and Home's mini city view
 * (WorldGeographySurface.tsx, via AdminHome.tsx).
 * Every other building still goes straight to Tower Wars, unchanged.
 *
 * Slice 5 §5.1 (docs/goldline/BUILD_BRIEF_SLICES_1_5.md): this screen used
 * to render hardcoded customer names, dollar figures, and invented "AI
 * pitch" reasoning — a standing-rule violation (no invented customers,
 * ever). It now reads real revenue contributors from
 * system.towerWars.today, the same authoritative source Tower Wars
 * itself uses. There is no real "South tower vs North tower" split within
 * Opus LA — that was never anything but decorative fiction — so real
 * customers are listed once, honestly, rather than pinned to an invented
 * half of the building. When there is no real contributor data yet, this
 * renders an honest empty state instead of fabricating one.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { centsToDollars } from "@shared/pricing";

const ASSETS = "/assets/admin/control-room/opus-la-inspection";

type Contributor = {
  identityKey: string;
  customerIdentity: string | null;
  customerDisplayName: string;
  customerPhone: string | null;
  contributedValueCents: number;
  orderCount: number;
  events: Array<{ eventId: string; orderId: string | number | null; occurredAt: string; valueCents: number }>;
};

function ContributorRow({ contributor, onOpen }: { contributor: Contributor; onOpen: (c: Contributor) => void }) {
  return (
    <button
      type="button"
      className="oli-plate"
      onClick={() => onOpen(contributor)}
      aria-label={`${contributor.customerDisplayName}, $${centsToDollars(contributor.contributedValueCents)}`}
    >
      <img src={`${ASSETS}/nameplate-frame.png`} alt="" />
      <span className="oli-plate-avatar">
        {contributor.customerDisplayName.slice(0, 2).toUpperCase()}
      </span>
      <span className="oli-plate-text">
        <b>{contributor.customerDisplayName}</b>
        <span>${centsToDollars(contributor.contributedValueCents)}</span>
      </span>
    </button>
  );
}

export function OpusLaInspection({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [selected, setSelected] = useState<Contributor | null>(null);
  const towerWarsToday = trpc.system.towerWars.today.useQuery(undefined, { retry: false });
  const contributors = (towerWarsToday.data?.contributors?.opus_la ?? []) as Contributor[];
  const totalValueCents = contributors.reduce((sum, c) => sum + c.contributedValueCents, 0);
  const topFive = contributors.slice(0, 5);

  return (
    <div className="oli-page">
      <div className="oli-stage">
        <img className="oli-weapon" src={`${ASSETS}/weapon.png`} alt="" />
        <div className="oli-towerwrap oli-south">
          <div className="oli-label">SOUTH TOWER</div>
          <img className="oli-tower" src={`${ASSETS}/south-tower.png`} alt="Opus LA South Tower" />
        </div>

        <div className="oli-weekly">
          <div className="oli-weekly-title">REAL ACTIVITY</div>
          <img src={`${ASSETS}/weekly-frame.png`} alt="" />
          {towerWarsToday.isLoading ? (
            <div className="oli-blk" style={{ top: "30%" }}>
              <div className="oli-blk-h">Loading…</div>
            </div>
          ) : towerWarsToday.error ? (
            <div className="oli-blk" style={{ top: "30%" }}>
              <div className="oli-blk-h">Activity data unavailable</div>
              <div className="oli-blk-l">Tower Wars settlement could not be reached.</div>
            </div>
          ) : topFive.length === 0 ? (
            <div className="oli-blk" style={{ top: "30%" }}>
              <div className="oli-blk-h">No recorded activity yet</div>
              <div className="oli-blk-l">
                No real orders at this building are recorded for the current
                rivalry window.
              </div>
            </div>
          ) : (
            <>
              <div className="oli-blk" style={{ top: "23%" }}>
                <div className="oli-blk-h">TOP CONTRIBUTORS</div>
                <div className="oli-blk-l">
                  {topFive.map(c => (
                    <div key={c.identityKey}>
                      {c.customerDisplayName} ${centsToDollars(c.contributedValueCents)}
                    </div>
                  ))}
                </div>
              </div>
              <div className="oli-blk" style={{ top: "58%" }}>
                <div className="oli-blk-h">TOTAL RECORDED</div>
                <div className="oli-blk-l">
                  ${centsToDollars(totalValueCents)} · {contributors.length} customer(s)
                </div>
              </div>
            </>
          )}
        </div>

        <div className="oli-towerwrap oli-north">
          <div className="oli-label">NORTH TOWER</div>
          <img className="oli-tower" src={`${ASSETS}/north-tower.png`} alt="Opus LA North Tower" />
        </div>
      </div>

      {topFive.length > 0 ? (
        <div className="oli-contributor-list" aria-label="Real contributors at this building">
          {topFive.map(c => (
            <ContributorRow key={c.identityKey} contributor={c} onOpen={setSelected} />
          ))}
        </div>
      ) : null}

      <div className="oli-cta-row">
        <button type="button" className="oli-cta" onClick={() => onNavigate("/growth/tower-wars?building=opus_la")}>
          INITIATE TOWER WAR!
        </button>
      </div>

      {selected ? (
        <div className="oli-overlay" onClick={() => setSelected(null)}>
          <div className="oli-card" onClick={e => e.stopPropagation()}>
            <h3>{selected.customerDisplayName}</h3>
            <div className="oli-card-stat">
              <span>Value</span>
              <span>
                ${centsToDollars(selected.contributedValueCents)} recorded · {selected.orderCount} order(s)
              </span>
            </div>
            <div className="oli-card-stat">
              <span>Last recorded event</span>
              <span className="oli-card-status">
                {selected.events[selected.events.length - 1]?.occurredAt
                  ? new Date(selected.events[selected.events.length - 1].occurredAt).toLocaleDateString()
                  : "Unknown"}
              </span>
            </div>
            <button type="button" className="oli-card-close" onClick={() => setSelected(null)}>Close</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
