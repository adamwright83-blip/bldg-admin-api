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
 *
 * The activity panel and contributor chips are built in plain CSS rather
 * than laid over the decorative nameplate/weekly-frame art: those frames
 * are a fixed pixel aspect ratio sized for short placeholder text, and a
 * real customer name of arbitrary length broke that layout (the frame's
 * box could collapse under a long name, stacking the avatar and text on
 * top of each other). Real, variable-length data needs a flexible
 * container, not art sized for a mockup string.
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

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ContributorChip({ contributor, onOpen }: { contributor: Contributor; onOpen: (c: Contributor) => void }) {
  return (
    <button
      type="button"
      className="oli-chip"
      onClick={() => onOpen(contributor)}
      aria-label={`${contributor.customerDisplayName}, $${centsToDollars(contributor.contributedValueCents)}`}
    >
      <span className="oli-chip-avatar">{initialsFor(contributor.customerDisplayName)}</span>
      <span className="oli-chip-text">
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

        <div className="oli-activity" aria-label="Real activity at this building">
          <div className="oli-activity-title">REAL ACTIVITY</div>
          <div className="oli-activity-body">
            {towerWarsToday.isLoading ? (
              <p className="oli-activity-status">Loading…</p>
            ) : towerWarsToday.error ? (
              <p className="oli-activity-status">
                Activity data unavailable — Tower Wars settlement could not be reached.
              </p>
            ) : topFive.length === 0 ? (
              <p className="oli-activity-status">
                No recorded activity yet. No real orders at this building are
                recorded for the current rivalry window.
              </p>
            ) : (
              <>
                <div className="oli-activity-section">
                  <div className="oli-activity-label">Top contributors</div>
                  <ul className="oli-activity-list">
                    {topFive.map(c => (
                      <li key={c.identityKey}>
                        <span className="oli-activity-name">{c.customerDisplayName}</span>
                        <span className="oli-activity-value">${centsToDollars(c.contributedValueCents)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="oli-activity-divider" />
                <div className="oli-activity-section">
                  <div className="oli-activity-label">Total recorded</div>
                  <div className="oli-activity-total">
                    ${centsToDollars(totalValueCents)}
                    <span className="oli-activity-total-count">
                      {" "}
                      · {contributors.length} customer{contributors.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="oli-towerwrap oli-north">
          <div className="oli-label">NORTH TOWER</div>
          <img className="oli-tower" src={`${ASSETS}/north-tower.png`} alt="Opus LA North Tower" />
        </div>
      </div>

      {topFive.length > 0 ? (
        <div className="oli-chip-row" aria-label="Real contributors at this building">
          {topFive.map(c => (
            <ContributorChip key={c.identityKey} contributor={c} onOpen={setSelected} />
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
            <div className="oli-card-avatar">{initialsFor(selected.customerDisplayName)}</div>
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
