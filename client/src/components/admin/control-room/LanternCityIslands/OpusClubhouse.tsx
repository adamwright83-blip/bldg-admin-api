import { useMemo, useState } from "react";
import type { TowerDeskBuildingId } from "@shared/towerDesk";
import { darkFloors, type BuildingModel, type BuildingSpec, type Resident } from "./towerStack";
import DeskSettings, { openDeskSettings } from "./DeskSettings";
import { money } from "./deskMoney";
import { DimReadout, Elevator, GoalFloors, LogReadout, ReferralReadout, ThenNow, useTowerDesk } from "./TowerDesk";
import styles from "./opus-clubhouse.module.css";

/**
 * OPUS LA's clubhouse: the same six readouts as Century Park East's front desk, but as things in the
 * animals' communal room instead of monitors. The album is the scrubber, the model is the floors, the brass
 * elevator is revenue (residents' lane live, the gym-towel contract lane not wired), the plant shelf is the
 * quiet residents, the mailroom is the log, the bulletin board is referrals.
 *
 * The room is a painted plate (Adam's render, 2026-10-27). Its labels and props are drawing: the plants'
 * alert pins and the photos on the board are scenery. Every number is a live chip laid over a prop, and
 * tapping the prop opens its full readout below the room.
 */
type Prop = "album" | "model" | "elevator" | "garden" | "mail" | "board";

const TITLES: Record<Prop, string> = {
  album: "1. Then → Now",
  model: "2. Where it needs to be",
  elevator: "3. Revenue elevator",
  garden: "4. The neglected garden",
  mail: "5. Doorman's log",
  board: "6. Who's bringing neighbors in",
};

export default function OpusClubhouse({
  buildingId,
  spec,
  model,
  rows,
  onShowQuiet,
}: {
  buildingId: TowerDeskBuildingId;
  spec: BuildingSpec;
  model: BuildingModel;
  rows: Resident[];
  onShowQuiet: () => void;
}) {
  const { desk, pending } = useTowerDesk(buildingId);
  const [open, setOpen] = useState<Prop>("elevator");
  const quietKeys = useMemo(() => new Set(rows.filter(r => r.quiet).map(r => r.key)), [rows]);
  const units = model.towers.reduce((n, t) => n + t.spec.floors * t.spec.unitsPerFloor, 0);
  const lit = model.towers.reduce((n, t) => n + t.lit, 0);
  const floors = model.towers.reduce((n, t) => n + t.spec.floors, 0);
  const litFloors = floors - model.towers.reduce((n, t) => n + darkFloors(t).length, 0);
  const run = desk?.revenue.totalLast30Cents ?? null;
  const assumed = model.towers.filter(t => t.spec.unitsAssumed);
  const goal = desk?.goalMonthlyCents ?? null;

  const chip = (prop: Prop, text: string, cls: string) => (
    <button
      type="button"
      className={`${styles.chip} ${cls} ${open === prop ? styles.chipOpen : ""}`}
      onClick={() => setOpen(prop)}
      aria-pressed={open === prop}
      aria-label={`${TITLES[prop]}: ${text}`}
      data-testid={`opus-chip-${prop}`}
    >
      {text}
    </button>
  );

  const body = (() => {
    if (open === "model") return <GoalFloors desk={desk} model={model} quietKeys={quietKeys} />;
    if (!desk) return pending;
    if (open === "album") return <ThenNow desk={desk} spec={spec} rows={rows} />;
    if (open === "elevator") return <Elevator desk={desk} />;
    if (open === "garden") {
      const quiet = rows.filter(r => r.quiet);
      return (
        <div className={styles.garden}>
          <DimReadout desk={desk} onShowQuiet={onShowQuiet} />
          {quiet.length ? (
            <ul className={styles.pots}>
              {quiet.map(r => <li key={r.key}>🪴 {r.unit ? `Unit ${r.unit}` : "No unit"} · {r.name}</li>)}
            </ul>
          ) : null}
        </div>
      );
    }
    if (open === "mail") return <LogReadout desk={desk} />;
    return <ReferralReadout desk={desk} />;
  })();

  return (
    <div className={styles.clubhouse} data-testid="opus-clubhouse">
      <p className={styles.sign}>
        The clubhouse · <b>{lit} of {units}</b> homes lit · tap anything in the room
        {assumed.length ? <> · * {assumed.map(t => t.spec.short).join(" and ")}: doors per floor is a starting guess. <button type="button" className={styles.signLink} onClick={openDeskSettings}>Set it in Building settings</button></> : null}
      </p>
      <div className={styles.roomScroll}>
        <div className={styles.room}>
          <img src="/goldline/opus-clubhouse/room.webp" alt="The OPUS clubhouse: an album, a model of both towers, a brass elevator, a plant shelf, a mailroom and a bulletin board" />
          {/* the painted plaques carry facts that change (floors, homes, what a lane is worth), so live ones sit over them */}
          <div className={styles.modelPlate} aria-hidden>
            {model.towers.map(t => (
              <span key={t.spec.id}>
                <b>{t.spec.short.toUpperCase()}</b>
                {t.spec.floors} FL · {t.spec.floors * t.spec.unitsPerFloor} HOMES{t.spec.unitsAssumed ? "*" : ""}
              </span>
            ))}
          </div>
          <button type="button" className={`${styles.lanePlaque} ${styles.laneContract}`} onClick={openDeskSettings} aria-label={desk?.contract ? `${desk.contract.name}: log a payment` : "Add a building contract"} data-testid="opus-contract-lane">
            {desk?.contract ? money(desk.contract.paid30Cents) : "Add"}
          </button>
          <button type="button" className={`${styles.lanePlaque} ${styles.laneResidents}`} onClick={() => setOpen("elevator")} aria-label="Resident orders, last 30 days" data-testid="opus-residents-lane">
            {desk?.revenue.last30Cents != null ? money(desk.revenue.last30Cents) : "…"}
          </button>
          {chip("album", desk?.firstOrderDay ? `Since ${new Date(`${desk.firstOrderDay}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}` : "The album", styles.atAlbum)}
          {chip("model", `${litFloors} of ${floors} floors lit`, styles.atModel)}
          {chip("elevator", run !== null && goal ? `${Math.round(Math.min(1, run / goal) * 100)}% of ${money(goal)}` : goal ? `Goal ${money(goal)}/mo` : "Set your goal", styles.atElevator)}
          {chip("garden", desk ? `${desk.dim.quietResidents} quiet${desk.dim.estMonthlyCents ? ` · ${money(desk.dim.estMonthlyCents)}/mo` : ""}` : "Quiet residents", styles.atGarden)}
          {chip("mail", desk ? `${desk.log.length ? `Latest: ${desk.log[0]!.unit ? `Unit ${desk.log[0]!.unit}` : desk.log[0]!.name}` : "No mail yet"}` : "The mailroom", styles.atMail)}
          {chip("board", desk?.referrals.status === "ok" && desk.referrals.freshness?.state !== "never" ? `${desk.referrals.involving} referrals` : "Set up referrals", styles.atBoard)}
        </div>
      </div>
      <section className={styles.panel} aria-live="polite" data-testid={`opus-panel-${open}`}>
        <h4>{TITLES[open]}</h4>
        <div className={styles.panelBody}>{body}</div>
      </section>
      {desk ? <DeskSettings desk={desk} spec={spec} /> : null}
    </div>
  );
}
