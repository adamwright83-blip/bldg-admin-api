/**
 * Opus LA tower inspection — South vs North, real Opus LA art.
 *
 * Reached from Opus LA's marker in both the live Lantern City scene
 * (LanternCitySceneV6/LanternCityScene.tsx) and Home's mini city view
 * (WorldGeographySurface.tsx, via AdminHome.tsx).
 * Every other building still goes straight to Tower Wars, unchanged.
 *
 * The name/dollar figures below are placeholder content, not yet wired to a
 * real per-tower revenue/customer query — that backend work is a separate
 * follow-up. This screen's job right now is the navigation shape (Lantern
 * City -> inspection -> Tower Wars) and the real approved art, not real data.
 */
import { useState } from "react";

const ASSETS = "/assets/admin/control-room/opus-la-inspection";

type Customer = {
  name: string;
  initials: string;
  tower: "South" | "North";
  level: number;
  lifetimeValue: string;
  orders: number;
  status: string;
  aiPitch: string;
};

const CUSTOMERS: Customer[] = [
  {
    name: "REED, K.",
    initials: "KR",
    tower: "South",
    level: 12,
    lifetimeValue: "$850",
    orders: 6,
    status: "No order in 52 days",
    aiPitch:
      "Reed switched to biweekly last spring then stopped after a late pickup. A one-time free rush credit plus a same-day slot would likely win them back — no discount pattern to reinforce.",
  },
  {
    name: "J. PARK",
    initials: "JP",
    tower: "North",
    level: 18,
    lifetimeValue: "$4,820",
    orders: 12,
    status: "Active customer",
    aiPitch:
      "Park is fully active and the highest-value resident here — no win-back needed. Best move is a referral ask, not a retention offer.",
  },
  {
    name: "M. CHEN",
    initials: "MC",
    tower: "North",
    level: 9,
    lifetimeValue: "$1,200",
    orders: 9,
    status: "No order in 38 days",
    aiPitch:
      "Chen is a high-frequency lapsed customer, not a discount shopper. A personal note referencing their usual order (bedding, folded) outperforms a coupon here.",
  },
];

function NamePlate({ customer, onOpen }: { customer: Customer; onOpen: (c: Customer) => void }) {
  return (
    <button type="button" className="oli-plate" onClick={() => onOpen(customer)} aria-label={`${customer.name}, ${customer.lifetimeValue}`}>
      <img src={`${ASSETS}/nameplate-frame.png`} alt="" />
      <span className="oli-plate-avatar">{customer.initials}</span>
      <span className="oli-plate-text">
        <b>{customer.name}</b>
        <span>{customer.lifetimeValue}</span>
      </span>
    </button>
  );
}

export function OpusLaInspection({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [selected, setSelected] = useState<Customer | null>(null);
  const southCustomers = CUSTOMERS.filter(c => c.tower === "South");
  const northCustomers = CUSTOMERS.filter(c => c.tower === "North");

  return (
    <div className="oli-page">
      <div className="oli-stage">
        <img className="oli-weapon" src={`${ASSETS}/weapon.png`} alt="" />
        <div className="oli-towerwrap oli-south">
          <div className="oli-label">SOUTH TOWER - LEADING</div>
          <img className="oli-tower" src={`${ASSETS}/south-tower.png`} alt="Opus LA South Tower" />
          {southCustomers.map((c, i) => (
            <div key={c.name} className="oli-plate-pos" style={{ top: `${34 + i * 18}%`, left: "2%" }}>
              <NamePlate customer={c} onOpen={setSelected} />
            </div>
          ))}
        </div>

        <div className="oli-weekly">
          <div className="oli-weekly-title">WEEKLY</div>
          <img src={`${ASSETS}/weekly-frame.png`} alt="" />
          <div className="oli-blk" style={{ top: "23%" }}>
            <div className="oli-blk-h">SOUTH TOP</div>
            <div className="oli-blk-l">
              {southCustomers.map(c => (
                <div key={c.name}>{c.name} {c.lifetimeValue}</div>
              ))}
            </div>
          </div>
          <div className="oli-blk" style={{ top: "40.5%" }}>
            <div className="oli-blk-h">NORTH TOP</div>
            <div className="oli-blk-l">
              {northCustomers.map(c => (
                <div key={c.name}>{c.name} {c.lifetimeValue}</div>
              ))}
            </div>
          </div>
          <div className="oli-blk" style={{ top: "58%" }}>
            <div className="oli-blk-h">WEEK TOTAL</div>
            <div className="oli-blk-l">Both towers: $6,870</div>
          </div>
        </div>

        <div className="oli-towerwrap oli-north">
          <div className="oli-label">NORTH TOWER - CATCHING UP</div>
          <img className="oli-tower" src={`${ASSETS}/north-tower.png`} alt="Opus LA North Tower" />
          {northCustomers.map((c, i) => (
            <div key={c.name} className="oli-plate-pos" style={{ top: `${20 + i * 20}%`, left: "34%" }}>
              <NamePlate customer={c} onOpen={setSelected} />
            </div>
          ))}
        </div>
      </div>

      <div className="oli-cta-row">
        <button type="button" className="oli-cta" onClick={() => onNavigate("/growth/tower-wars?building=opus_la")}>
          INITIATE TOWER WAR!
        </button>
      </div>

      {selected ? (
        <div className="oli-overlay" onClick={() => setSelected(null)}>
          <div className="oli-card" onClick={e => e.stopPropagation()}>
            <h3>{selected.name}</h3>
            <div className="oli-card-meta">{selected.tower} · Level {selected.level}</div>
            <div className="oli-card-stat"><span>Value</span><span>{selected.lifetimeValue} lifetime · {selected.orders} orders</span></div>
            <div className="oli-card-stat"><span>Status</span><span className="oli-card-status">{selected.status}</span></div>
            <div className="oli-card-ai">
              <b>Agentic AI — proposed approach</b>
              {selected.aiPitch}
            </div>
            <button type="button" className="oli-card-approve">Approve &amp; Queue Win-Back</button>
            <button type="button" className="oli-card-close" onClick={() => setSelected(null)}>Close</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
