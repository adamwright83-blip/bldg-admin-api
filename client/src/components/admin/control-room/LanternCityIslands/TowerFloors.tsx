import { useEffect, useMemo, useRef, useState } from "react";
import type { GeographicCustomer } from "../customerGeography";
import { createTowerRooms, type RoomHover } from "./towerRooms";
import { buildTowerModel, darkFloors, TOWER_BUILDINGS, unitOf, type Resident } from "./towerStack";
import styles from "./tower-floors.module.css";

/**
 * One of our towers opened floor by floor, from the atlas's real customers: each customer's own
 * street address picks the tower and their own unit number picks the floor. Nothing here is
 * sample data; a customer whose unit can't be read is listed, not placed.
 */
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
  const spec = TOWER_BUILDINGS.find(b => b.id === buildingId);
  const residents = useMemo<(Resident & { phone: string | null })[]>(
    () =>
      customers
        .map(c => {
          const address = c.address ?? c.location?.canonicalAddress ?? "";
          return { key: c.identityKey, name: c.displayName, address, unit: unitOf(c.unit, address), phone: c.phone };
        })
        .filter(r => r.address),
    [customers],
  );
  const model = useMemo(() => (spec ? buildTowerModel(spec, residents) : null), [spec, residents]);
  const view = useRef<ReturnType<typeof createTowerRooms> | null>(null);

  useEffect(() => {
    if (!host.current) return;
    try {
      view.current = createTowerRooms(host.current, { onHover: setHover });
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
  const phoneOf = new Map(residents.map(r => [r.key, r.phone]));

  return (
    <div className={styles.overlay} role="dialog" aria-label={`${spec.name} floors`} data-tower-floors={spec.id}>
      <header className={styles.head}>
        <div>
          <h2>{spec.name}</h2>
          <p className={styles.stat}>
            {lit} of {units} homes lit · {dark} of {floors} floors with no customer
          </p>
          <p className={styles.note}>
            Floors come from each customer's unit number
            {spec.numberingConfirmed ? "." : " (1507 read as floor 15; not yet confirmed for this building)."} Where a lit
            room sits along its floor is illustrative. Rooms are scenery.
          </p>
        </div>
        <button type="button" onClick={onClose}>Back to the city</button>
      </header>
      <div className={styles.body}>
        <div ref={host} className={styles.stage} />
        <aside className={styles.list} aria-label="Customers in this building">
          <h3>{here.length} customer{here.length === 1 ? "" : "s"} here</h3>
          <ul>
            {here.map(r => (
              <li key={r.key}>
                <span>{r.name}</span>
                <small>{r.unit ? `Unit ${r.unit}` : "No unit given"}{unplaced.includes(r) ? " · not placed" : ""}</small>
                {onOpenCustomer && phoneOf.get(r.key) ? (
                  <button type="button" onClick={() => onOpenCustomer(phoneOf.get(r.key)!)}>Open</button>
                ) : null}
              </li>
            ))}
          </ul>
          {!here.length ? <p className={styles.empty}>No customers at this address yet. Every floor is a door to knock on.</p> : null}
        </aside>
      </div>
      {hover ? (
        <div className={styles.tip} style={{ left: Math.min(hover.x + 16, window.innerWidth - 260), top: Math.max(hover.y - 70, 8) }}>
          <b>{hover.residents.length === 1 ? hover.residents[0].name : `${hover.residents.length} customers`}</b>
          <span>{hover.residents.length > 1 ? `${hover.residents.map(r => r.name).join("\n")}\n` : ""}{hover.label}</span>
        </div>
      ) : null}
    </div>
  );
}
