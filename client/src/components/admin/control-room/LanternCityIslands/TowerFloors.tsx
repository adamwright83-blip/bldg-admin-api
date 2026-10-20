import { useEffect, useMemo, useRef, useState } from "react";
import type { GeographicCustomer } from "../customerGeography";
import { createTowerRooms, type LobbyRect, type RoomHover } from "./towerRooms";
import { buildTowerModel, darkFloors, TOWER_BUILDINGS, unitOf, type Resident } from "./towerStack";
import { openCenturyParkEastGame } from "@/pages/goldline/centuryParkEast3d/centuryParkEastEntry";
import styles from "./tower-floors.module.css";

/**
 * One of our towers opened floor by floor, from the atlas's real customers: each customer's own
 * street address picks the tower and their own unit number picks the floor. Nothing here is
 * sample data; a customer whose unit can't be read is listed, not placed.
 *
 * Data first: the header carries the building's sales, a resident quiet for 45+ days keeps a dim lamp on, and tapping
 * a lit window opens that resident's card with a one-tap text from your own phone. Century Park East's lobby is also
 * the door into its game: something is banging on the glass.
 */
const QUIET_DAYS = 45;
const GAME_BUILDINGS = new Set(["century_park_east"]);

type Row = Resident & { phone: string | null; days: number | null; spendCents: number; orders: number };

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;

function textHref(r: Row): string | null {
  const digits = (r.phone ?? "").replace(/[^\d+]/g, "");
  if (!digits) return null;
  const first = r.name.split(" ")[0] || r.name;
  const body = r.days !== null
    ? `Hey ${first}! It's Adam. It's been about ${r.days} days since your last pickup. Want us to grab your laundry this week?`
    : `Hey ${first}! It's Adam. Want us to grab your laundry this week?`;
  return `sms:${digits}?&body=${encodeURIComponent(body)}`;
}

export default function TowerFloors({
  buildingId,
  customers,
  onClose,
  onOpenCustomer,
}: {
  buildingId: string;
  customers: GeographicCustomer[];
  onClose: () => void;
  onOpenCustomer?: (phone: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<RoomHover>(null);
  const [picked, setPicked] = useState<NonNullable<RoomHover> | null>(null);
  const [lobbies, setLobbies] = useState<LobbyRect[]>([]);
  const spec = TOWER_BUILDINGS.find(b => b.id === buildingId);
  const residents = useMemo<Row[]>(
    () =>
      customers
        .map(c => {
          const address = c.address ?? c.location?.canonicalAddress ?? "";
          const days = c.lastOrderAt ? c.cadence.daysSinceLastOrder : null;
          return {
            key: c.identityKey,
            name: c.displayName,
            address,
            unit: unitOf(c.unit, address),
            phone: c.phone,
            days,
            quiet: days !== null && days >= QUIET_DAYS,
            spendCents: c.totalSpendCents ?? 0,
            orders: c.totalOrders ?? 0,
          };
        })
        .filter(r => r.address),
    [customers],
  );
  const model = useMemo(() => (spec ? buildTowerModel(spec, residents) : null), [spec, residents]);
  const view = useRef<ReturnType<typeof createTowerRooms> | null>(null);

  useEffect(() => {
    if (!host.current) return;
    try {
      view.current = createTowerRooms(host.current, { onHover: setHover, onPick: setPicked, onLobbies: setLobbies });
    } catch (e) {
      console.warn("Tower view needs WebGL", e);
    }
    return () => { view.current?.dispose(); view.current = null; };
  }, []);
  useEffect(() => { if (model) view.current?.show(model); }, [model]);

  if (!spec || !model) return null;
  const here = model.towers.flatMap(t => [...t.floors.flat(2), ...t.floorOnly.flat(), ...t.unplaced]);
  const units = model.towers.reduce((n, t) => n + t.spec.floors * t.spec.unitsPerFloor, 0);
  const lit = model.towers.reduce((n, t) => n + t.lit, 0);
  const dark = model.towers.reduce((n, t) => n + darkFloors(t).length, 0), floors = model.towers.reduce((n, t) => n + t.spec.floors, 0);
  const unplaced = model.towers.flatMap(t => t.unplaced);
  const byKey = new Map(residents.map(r => [r.key, r]));
  const rows = here.map(r => byKey.get(r.key)!).filter(Boolean);
  const lifetime = rows.reduce((n, r) => n + r.spendCents, 0);
  const active30 = rows.filter(r => r.days !== null && r.days <= 30).length;
  const quiet = rows.filter(r => r.quiet).length;
  const zombieNight = (() => {
    try {
      return window.localStorage.getItem("centuryParkEast.vibe") === "\"zombie\"";
    } catch {
      return false;
    }
  })();
  const hasGame = GAME_BUILDINGS.has(spec.id);

  return (
    <div className={styles.overlay} role="dialog" aria-label={`${spec.name} floors`} data-tower-floors={spec.id}>
      <header className={styles.head}>
        <div>
          <h2>{spec.name}</h2>
          <p className={styles.stat} data-testid="tower-sales">
            {money(lifetime)} lifetime from {rows.length} resident{rows.length === 1 ? "" : "s"} · {active30} ordered in the last 30 days · {quiet} quiet {QUIET_DAYS}+ days (dim windows)
          </p>
          <p className={styles.stat}>
            {lit} of {units} homes lit · {dark} of {floors} floors with no customer
          </p>
          <p className={styles.note}>
            Floors come from each customer's unit number
            {spec.numberingConfirmed ? "." : " (1507 read as floor 15; not yet confirmed for this building)."} Where a lit
            room sits along its floor is illustrative. Rooms are scenery. Tap a lit window for that resident.
          </p>
        </div>
        <div className={styles.headActions}>
          {hasGame ? (
            <button type="button" className={styles.playButton} onClick={openCenturyParkEastGame} data-testid="tower-play">
              {zombieNight ? "🧟 Something's in the lobby" : "🕯️ Play the building"}
            </button>
          ) : null}
          <button type="button" onClick={onClose}>Back to the city</button>
        </div>
      </header>
      <div className={styles.body}>
        <div className={styles.stageWrap}>
          <div ref={host} className={styles.stage} />
          {hasGame
            ? lobbies.map(l => (
                <button
                  key={l.id}
                  type="button"
                  className={`${styles.lobbyDoor} ${zombieNight ? styles.lobbyZombie : styles.lobbyCozy}`}
                  style={{ left: l.x, top: l.y, width: Math.max(0, l.w), height: Math.max(0, l.h) }}
                  onClick={openCenturyParkEastGame}
                  aria-label="Go into the lobby and play"
                  data-testid="tower-lobby-door"
                >
                  <span className={styles.lobbyHands} aria-hidden>{zombieNight ? "🧟 ✋ ✋ 🧟‍♀️" : "🐶 💤 🐩"}</span>
                  <span className={styles.lobbyTag}>{zombieNight ? "Something's in the lobby. Tap to go in." : "The lobby's lit. Tap to play."}</span>
                </button>
              ))
            : null}
        </div>
        <aside className={styles.list} aria-label="Customers in this building">
          <h3>{here.length} customer{here.length === 1 ? "" : "s"} here</h3>
          <ul>
            {rows.map(r => (
              <li key={r.key} className={r.quiet ? styles.quietRow : ""}>
                <span>{r.name}</span>
                <small>
                  {r.unit ? `Unit ${r.unit}` : "No unit given"}
                  {r.days !== null ? ` · ${r.days}d since last order` : ""}
                  {unplaced.some(u => u.key === r.key) ? " · not placed" : ""}
                </small>
                {textHref(r) ? <a className={styles.textLink} href={textHref(r)!}>Text</a> : null}
                {onOpenCustomer && r.phone ? (
                  <button type="button" onClick={() => onOpenCustomer(r.phone!)}>Open</button>
                ) : null}
              </li>
            ))}
          </ul>
          {!here.length ? <p className={styles.empty}>No customers at this address yet. Every floor is a door to knock on.</p> : null}
        </aside>
      </div>
      {hover && !picked ? (
        <div className={styles.tip} style={{ left: Math.min(hover.x + 16, window.innerWidth - 260), top: Math.max(hover.y - 70, 8) }}>
          <b>{hover.residents.length === 1 ? hover.residents[0].name : `${hover.residents.length} customers`}</b>
          <span>{hover.residents.length > 1 ? `${hover.residents.map(r => r.name).join("\n")}\n` : ""}{hover.label}</span>
        </div>
      ) : null}
      {picked ? (
        <div className={styles.unitCard} role="dialog" aria-label="Resident" data-testid="tower-unit-card">
          <div className={styles.unitHead}>
            <small>{picked.label}</small>
            <button type="button" onClick={() => setPicked(null)} aria-label="Close">✕</button>
          </div>
          {picked.residents.map(p => {
            const r = byKey.get(p.key);
            if (!r) return null;
            const href = textHref(r);
            return (
              <div key={r.key} className={styles.unitRow}>
                <b>{r.name}</b>
                <span>
                  {r.days !== null ? `${r.days} days since last order` : "No order date on file"} · {r.orders} order{r.orders === 1 ? "" : "s"} · {money(r.spendCents)}
                  {r.quiet ? " · quiet" : ""}
                </span>
                <div className={styles.unitActions}>
                  {href ? <a className={styles.textButton} href={href} data-testid="tower-unit-text">Text {r.name.split(" ")[0]} from your phone</a> : <em>No phone on file</em>}
                  {onOpenCustomer && r.phone ? <button type="button" onClick={() => onOpenCustomer(r.phone!)}>Open profile</button> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
