import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { trpc } from "@/lib/trpc";
import type { IslandBoard } from "./islandBoard";
import {
  LEVEL_LABEL,
  TODAY_STATUS_LINE,
  buildObjectiveMarkers,
  driverLinkForRun,
  type ObjectiveMarker,
} from "./objectiveMarksView";
import styles from "./lantern-city-islands.module.css";

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(+d)
    ? iso
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/**
 * The one-loop proof on the Islands board: today's Day Line run targets, the
 * area where Driver measured presence, and targets whose own evidence changed
 * them. Everything comes from `system.lanternCity.objectiveMarks`; on failure
 * nothing is drawn. No sample data, no browser storage.
 */
export default function ObjectiveMarksLayer({
  board,
  ready,
  onNavigate,
}: {
  board: RefObject<IslandBoard | null>;
  ready: boolean;
  onNavigate?: (path: string) => void;
}) {
  const marks = trpc.system.lanternCity.objectiveMarks.useQuery(undefined, {
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const markers = useMemo(() => buildObjectiveMarkers(marks.data), [marks.data]);
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const [open, setOpen] = useState<ObjectiveMarker | null>(null);

  // Follow the camera: reposition each marker every frame from the board's own projection.
  useEffect(() => {
    if (!ready || markers.length === 0) return;
    let raf = 0;
    const place = () => {
      const b = board.current;
      for (const m of markers) {
        const el = nodes.current.get(m.key);
        if (!el) continue;
        const at = b?.project(m.latitude, m.longitude) ?? null;
        if (!at || !at.visible) {
          el.style.visibility = "hidden";
          continue;
        }
        el.style.visibility = "visible";
        el.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)`;
      }
      raf = requestAnimationFrame(place);
    };
    raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [board, ready, markers]);

  // Keep an open receipt bound to the current server projection. If its
  // evidence changes on refetch, replace the stale marker object in-place; if
  // it disappears, close the panel.
  useEffect(() => {
    if (!open) return;
    const current = markers.find(m => m.key === open.key) ?? null;
    if (!current) setOpen(null);
    else if (current !== open) setOpen(current);
  }, [markers, open]);

  const today = marks.data?.today ?? null;
  const statusLine = marks.isError
    ? "Today's targets could not load. Nothing is lit until they do."
    : marks.data
      ? TODAY_STATUS_LINE[marks.data.todayStatus]
      : null;

  return (
    <>
      <div className={styles.marks} aria-label="Today's objective and field evidence">
        {markers.map(m => (
          <button
            key={m.key}
            ref={el => {
              if (el) nodes.current.set(m.key, el);
              else nodes.current.delete(m.key);
            }}
            type="button"
            className={
              m.kind === "presence"
                ? styles.markPresence
                : `${styles.markTarget} ${m.today ? styles.markToday : ""} ${m.level ? styles[`mark_${m.level}`] : ""}`
            }
            style={{ visibility: "hidden" }}
            data-mark-kind={m.kind}
            data-mark-level={m.kind === "target" ? m.level ?? "none" : undefined}
            aria-label={
              m.kind === "presence"
                ? `Measured presence, ${when(m.occurredAt)}`
                : `${m.label}${m.level ? `, ${LEVEL_LABEL[m.level]}` : ""}`
            }
            onClick={() => setOpen(m)}
          />
        ))}
      </div>

      {today ? (
        <div className={styles.todayBar}>
          <span className={styles.todayKicker}>Today</span>
          <b>{today.title}</b>
          <span>
            {today.targets.length} target{today.targets.length === 1 ? "" : "s"} ·{" "}
            {today.targets.filter(t => t.level === "completed").length} complete
          </span>
          {today.driverOpenable ? (
            <button type="button" onClick={() => onNavigate?.(driverLinkForRun(today.campaignRunId))}>
              Open in Driver
            </button>
          ) : null}
        </div>
      ) : statusLine ? (
        <div className={styles.todayBar} data-lantern-today="empty">
          <span>{statusLine}</span>
        </div>
      ) : null}

      {open ? (
        <section className={styles.receipt} aria-label="Evidence behind this mark">
          {open.kind === "presence" ? (
            <>
              <h2>Measured presence</h2>
              <p>
                Driver measured the operator inside this run's territory. GPS proves the area, not which
                building.
              </p>
              <ul>
                <li>
                  <code>{open.eventId}</code> · territory_presence · device_location · {when(open.occurredAt)}
                  {open.accuracyMeters != null ? ` · ±${open.accuracyMeters}m` : ""}
                </li>
              </ul>
            </>
          ) : (
            <>
              <h2>{open.label}</h2>
              <p>
                {open.level
                  ? LEVEL_LABEL[open.level]
                  : "On today's run. No evidence recorded against this building yet."}
              </p>
              {open.evidence.length ? (
                <ul>
                  {open.evidence.map(e => (
                    <li key={e.eventId}>
                      <code>{e.eventId}</code> · {e.kind} · {e.provenance} · {e.epistemicState} ·{" "}
                      {when(e.occurredAt)}
                    </li>
                  ))}
                </ul>
              ) : null}
              {open.today && today?.driverOpenable ? (
                <button type="button" onClick={() => onNavigate?.(driverLinkForRun(open.campaignRunId))}>
                  Open in Driver
                </button>
              ) : null}
            </>
          )}
          <button type="button" onClick={() => setOpen(null)}>
            Close
          </button>
        </section>
      ) : null}
    </>
  );
}
