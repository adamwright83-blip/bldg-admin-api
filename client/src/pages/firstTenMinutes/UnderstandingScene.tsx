import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState, type ReactNode } from "react";
import {
  objectNames,
  UNDERSTANDING_COPY,
  type FindingView,
  type SourceRef,
  type UnderstandingView,
} from "@shared/firstTenMinutesFindings";
import { CrewMember } from "./crew";
import { SourceNote } from "./SourceNote";
import styles from "./firstTen.module.css";

/**
 * 0:30, the crew gets acquainted. The world appears quietly; the crew arrives at the edges with small objects; the
 * line in the lamplight is the work actually running; real names land on the objects as findings are verified.
 * No progress counter and no forced wait.
 */
type ObjectKey = "map" | "notebook" | "folder" | "photograph";

function sourcesFor(findings: FindingView[], key: ObjectKey): SourceRef[] {
  const live = findings.filter(finding => finding.status !== "dismissed" && finding.status !== "changed");
  const pick = (kind: FindingView["payload"]["kind"]) => live.find(finding => finding.payload.kind === kind)?.sources ?? [];
  if (key === "map") return pick("business").length ? pick("business") : pick("place");
  if (key === "notebook") return pick("person");
  if (key === "folder") return pick("service");
  return pick("image");
}

function DeskObject({
  kind,
  name,
  onOpen,
  children,
}: {
  kind: ObjectKey;
  name: string | null;
  onOpen: (() => void) | null;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const label = name ? `${kind}: ${name}` : kind;
  return (
    <motion.button
      type="button"
      className={`${styles.deskObject} ${styles[`obj_${kind}`]}`}
      data-object={kind}
      data-named={name ? "yes" : "no"}
      aria-label={onOpen ? `${label}. Where this came from` : label}
      disabled={!onOpen}
      onClick={onOpen ?? undefined}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
    >
      {children}
      <span className={styles.objectName}>
        <AnimatePresence mode="wait">
          {name ? (
            <motion.span key={name} initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
              {name}
            </motion.span>
          ) : (
            <span className={styles.objectBlank} aria-hidden="true" />
          )}
        </AnimatePresence>
      </span>
    </motion.button>
  );
}

export function UnderstandingScene({
  view,
  onAgain,
  onLookCloser,
}: {
  view: UnderstandingView | null;
  onAgain: () => void;
  onLookCloser: () => void;
}) {
  const [open, setOpen] = useState<ObjectKey | null>(null);
  const findings = view?.findings ?? [];
  const names = objectNames(findings);
  const finished = new Set(view?.finished ?? []);
  const stage = view?.stage ?? null;
  const reached = (key: "people" | "conversations" | "work") => finished.has(key) || stage === key;
  const opener = (key: ObjectKey) => (sourcesFor(findings, key).length ? () => setOpen(key) : null);

  return (
    <section className={styles.readingScene} data-testid="first-ten-understanding" data-status={view?.status ?? "idle"}>
      <div className={styles.objects}>
        <DeskObject kind="map" name={names.map} onOpen={opener("map")}>
          <svg className={styles.mapLines} viewBox="0 0 200 120" aria-hidden="true">
            <path d="M8 92 C 46 70, 70 88, 104 60 S 170 30, 194 40" />
            <path d="M20 20 L 70 46 L 66 110" />
            <path d="M120 8 L 132 64 L 186 104" />
            <path d="M0 58 L 200 70" className={styles.mapRoad} />
          </svg>
        </DeskObject>
        <DeskObject kind="notebook" name={names.notebook} onOpen={opener("notebook")} />
        <DeskObject kind="folder" name={names.folder} onOpen={opener("folder")} />
        <DeskObject kind="photograph" name={names.photograph} onOpen={opener("photograph")}>
          <span className={styles.photoBlank} aria-hidden="true" />
        </DeskObject>
      </div>

      <div className={styles.lampLine} aria-live="polite">
        <AnimatePresence mode="wait">
          {view?.status === "running" && stage ? (
            <motion.p key={stage} className={styles.workLine} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
              {UNDERSTANDING_COPY[stage]}
            </motion.p>
          ) : view?.status === "failed" ? (
            <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <p className={styles.workLine}>{view.notes[view.notes.length - 1] ?? "Your crew couldn't finish reading."}</p>
              <button type="button" className={styles.deskLink} onClick={onAgain}>
                Try again
              </button>
            </motion.div>
          ) : view?.status === "complete" ? (
            <motion.div key="complete" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
              <button type="button" className={styles.deskLink} onClick={onLookCloser} data-testid="first-ten-look-closer">
                Look closer
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>
        {view?.notes.length && view.status !== "failed" ? (
          <ul className={styles.readingNotes}>
            {view.notes.map(note => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* each arrives when the work it carries begins; each stands by its own object (map, envelopes, photograph, notebook) */}
      <div className={styles.crewRow} aria-hidden="true">
        <span className={styles.crewSlot}>{reached("work") ? <CrewMember who="mara" from="left" delay={0.1} /> : null}</span>
        <span className={styles.crewSlot}>{reached("conversations") ? <CrewMember who="rook" from="left" /> : null}</span>
        <span className={styles.crewSlot}>{reached("work") ? <CrewMember who="luma" from="right" delay={0.3} /> : null}</span>
        <span className={styles.crewSlot}>{reached("people") ? <CrewMember who="sable" from="right" /> : null}</span>
      </div>

      {open ? (
        <div className={styles.scrim} onClick={() => setOpen(null)}>
          <div onClick={event => event.stopPropagation()}>
            <SourceNote sources={sourcesFor(findings, open)} onClose={() => setOpen(null)} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
