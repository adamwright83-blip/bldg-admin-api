import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CORRECTED_LINES,
  CREW_ORDER,
  SABLE_AFTER,
  buildReveals,
  crewLines,
  suggestionRules,
  type Reveal,
} from "@shared/firstTenMinutesCrew";
import {
  UNDERSTANDING_COPY,
  objectNames,
  type CompanionId,
  type FindingView,
  type UnderstandingView,
} from "@shared/firstTenMinutesFindings";
import { CrewEdge } from "./CrewEdge";
import { FindingNote } from "./FindingNote";
import { ContrastCards, HabitStrips, NotebookPage, ObjectFrame, Photograph, PlacesMap, RuleSheet, WeekStrip } from "./objects";
import styles from "./crew.module.css";

/**
 * The crew gets acquainted: one scene, no Next screens. The person's own words open it on a nearly empty desk, Sable
 * steps in from the bottom edge, and each companion in turn points at something of the person's. Every object can be
 * opened for its source and corrected; the scene waits while anything is open. Sable's question waits for an answer.
 */
type Answer = (findingId: string, answer: "confirm" | "change" | "dismiss", correction?: string) => Promise<void>;
type ObjectKey = "rule" | "map" | "strips" | "cards" | "photo" | "notebook";

const OBJECT_OF: Record<CompanionId, ObjectKey> = {
  sable: "rule",
  mara: "map",
  rook: "strips",
  bront: "cards",
  luma: "photo",
  orren: "map",
  ilex: "notebook",
};

/** Where a settled object rests: left or right of the stage. */
const SIDE: Record<ObjectKey, "left" | "right"> = { rule: "left", map: "left", strips: "right", cards: "right", photo: "right", notebook: "left" };

function stepKey(journeyId: string) {
  return `joystick_first_ten_crew:${journeyId}`;
}
function readSeen(journeyId: string): CompanionId[] {
  try {
    const raw = sessionStorage.getItem(stepKey(journeyId));
    return raw ? (JSON.parse(raw) as CompanionId[]).filter(who => CREW_ORDER.includes(who)) : [];
  } catch {
    return [];
  }
}

export function CrewScene({
  journeyId,
  view,
  picture,
  onAnswer,
  onFinished,
}: {
  journeyId: string;
  view: UnderstandingView;
  picture: string | null;
  onAnswer: Answer;
  onFinished: () => void;
}) {
  const reduce = useReducedMotion();
  const final = view.status === "complete" || view.status === "failed";
  const reveals = useMemo(() => buildReveals(view.findings, { final }), [view.findings, final]);
  const byCompanion = useMemo(() => new Map(reveals.map(reveal => [reveal.companion, reveal])), [reveals]);
  // what is drawn on the desk: everything revealed so far, corrected or not
  const onDesk = useMemo(
    () => new Map(buildReveals(view.findings, { final, includeCorrected: true }).map(reveal => [reveal.companion, reveal])),
    [view.findings, final]
  );
  const [seen, setSeen] = useState<CompanionId[]>(() => readSeen(journeyId));
  const [beat, setBeat] = useState(0);
  const [after, setAfter] = useState<string | null>(null);
  const [open, setOpen] = useState<ObjectKey | null>(null);
  const [answering, setAnswering] = useState(false);
  const [changing, setChanging] = useState(false);
  const [newRule, setNewRule] = useState("");
  const [aside, setAside] = useState<{ who: CompanionId; line: string } | null>(null);
  const finishedOnce = useRef(false);

  const current: Reveal | null = useMemo(() => {
    const next = CREW_ORDER.find(who => byCompanion.has(who) && !seen.includes(who));
    return next ? byCompanion.get(next)! : null;
  }, [byCompanion, seen]);
  const lines = current ? crewLines(current) : [];
  const sableWaiting = current?.companion === "sable" && current.finding.status === "proposed";

  useEffect(() => {
    try {
      sessionStorage.setItem(stepKey(journeyId), JSON.stringify(seen));
    } catch {
      /* the scene replays from the start if storage is unavailable */
    }
  }, [journeyId, seen]);

  // A Sable reveal already answered on a reload goes straight to her after-line.
  useEffect(() => {
    if (current?.companion !== "sable" || after) return;
    if (current.finding.status === "confirmed") setAfter(SABLE_AFTER.confirmed);
  }, [current, after]);

  const advance = useCallback(() => {
    if (!current) return;
    if (beat === 0) return setBeat(1);
    if (beat === 1) return setBeat(lines.length > 1 || after ? 2 : 3);
    if (beat === 2) return setBeat(3);
    setSeen(list => [...list, current.companion]);
    setBeat(0);
    setAfter(null);
  }, [beat, current, lines.length, after]);

  // The director: holds each beat for a moment, never while the person is reading a source or answering Sable.
  useEffect(() => {
    if (!current || open || answering) return;
    if (beat === 1 && sableWaiting && !after) return;
    const holds = reduce ? [300, 1600, 1400, 400] : [900, 2800, 2600, 1100];
    const timer = window.setTimeout(advance, holds[beat] ?? 900);
    return () => window.clearTimeout(timer);
  }, [current, beat, open, answering, sableWaiting, after, advance, reduce]);

  useEffect(() => {
    if (current || !final || finishedOnce.current) return;
    finishedOnce.current = true;
    onFinished();
  }, [current, final, onFinished]);

  async function answerSable(answer: "confirm" | "change", correction?: string) {
    if (!current || current.companion !== "sable") return;
    setAnswering(true);
    try {
      await onAnswer(current.finding.id, answer, correction);
      setAfter(answer === "confirm" ? SABLE_AFTER.confirmed : SABLE_AFTER.changed);
      setBeat(2);
    } finally {
      setAnswering(false);
    }
  }

  async function correct(finding: FindingView, answer: "change" | "dismiss", correction?: string) {
    await onAnswer(finding.id, answer, correction);
    const who = finding.companion ?? (finding.payload.kind === "place" ? "mara" : null);
    if (!who) return;
    // a corrected reveal has had its turn: it settles on the desk, greyed, and the scene moves on
    if (current?.companion === who) {
      setBeat(0);
      setAfter(null);
    }
    setSeen(list => (list.includes(who) ? list : [...list, who]));
    setAside({ who, line: CORRECTED_LINES[who] });
  }

  useEffect(() => {
    if (!aside) return;
    const timer = window.setTimeout(() => setAside(null), 2600);
    return () => window.clearTimeout(timer);
  }, [aside]);

  // ---------------------------------------------------------------- what is on the desk
  const present = CREW_ORDER.filter(who => seen.includes(who) || current?.companion === who);
  const stageObjects: ObjectKey[] = current
    ? current.companion === "ilex"
      ? ["map", "notebook"]
      : [OBJECT_OF[current.companion]]
    : [];
  const sable = onDesk.get("sable") as Extract<Reveal, { companion: "sable" }> | undefined;
  const mara = onDesk.get("mara") as Extract<Reveal, { companion: "mara" }> | undefined;
  const rook = onDesk.get("rook") as Extract<Reveal, { companion: "rook" }> | undefined;
  const bront = onDesk.get("bront") as Extract<Reveal, { companion: "bront" }> | undefined;
  const luma = onDesk.get("luma") as Extract<Reveal, { companion: "luma" }> | undefined;
  const orren = onDesk.get("orren") as Extract<Reveal, { companion: "orren" }> | undefined;
  const ilex = onDesk.get("ilex") as Extract<Reveal, { companion: "ilex" }> | undefined;
  const rules = suggestionRules(view.findings);
  const routeShown = Boolean(orren && (seen.includes("orren") || current?.companion === "orren" || current?.companion === "ilex"));
  const sableShown = Boolean(sable && (seen.includes("sable") || current?.companion === "sable"));
  const businessName = objectNames(view.findings).map;
  const request = ilex ? view.findings.find(finding => finding.id === (ilex.finding.payload.kind === "opportunity" ? ilex.finding.payload.requestId : "")) : undefined;

  function renderObject(key: ObjectKey, big: boolean) {
    const live = (finding: FindingView | undefined) => Boolean(finding && finding.status !== "changed" && finding.status !== "dismissed");
    switch (key) {
      case "rule":
        if (!sable) return null;
        return (
          <ObjectFrame label="Your words" big={big} onOpen={() => setOpen("rule")} testId="first-ten-object-rule" corrected={sable.finding.status === "changed" || sable.finding.status === "dismissed"}>
            <RuleSheet
              quote={sable.quote}
              to={sable.to}
              at={sable.at}
              straight={beat >= 1 || seen.includes("sable")}
              struck={sable.finding.status === "changed" || sable.finding.status === "dismissed"}
              pinned={sable.finding.status === "confirmed" && sable.days.length === 0}
            />
          </ObjectFrame>
        );
      case "map":
        if (!mara && !orren) return null;
        return (
          <ObjectFrame label="Your map" big={big} onOpen={() => setOpen("map")} testId="first-ten-object-map">
            <PlacesMap
              title={businessName}
              pins={(mara?.pins ?? []).filter(pin => live(view.findings.find(finding => finding.id === pin.findingId)))}
              unpinned={mara?.unpinned ?? []}
              clustered={Boolean(mara?.clustered)}
              route={orren?.stops ?? null}
              showRoute={routeShown}
              highlight={orren?.meets && routeShown ? orren.meets.placeFindingId : null}
              threadFrom={current?.companion === "ilex" || seen.includes("ilex") ? ilex?.placeFindingId ?? null : null}
            />
          </ObjectFrame>
        );
      case "strips":
        return rook ? (
          <ObjectFrame label="How you end your mail" big={big} onOpen={() => setOpen("strips")} testId="first-ten-object-strips" corrected={!live(rook.finding)}>
            <HabitStrips examples={rook.examples} />
          </ObjectFrame>
        ) : null;
      case "cards":
        return bront ? (
          <ObjectFrame label="What people ask you for" big={big} onOpen={() => setOpen("cards")} testId="first-ten-object-cards" corrected={!live(bront.finding)}>
            <ContrastCards
              a={bront.a}
              b={bront.b}
              showA={seen.includes("bront") || (current?.companion === "bront" && beat >= 1)}
              showB={seen.includes("bront") || (current?.companion === "bront" && beat >= 2)}
            />
          </ObjectFrame>
        ) : null;
      case "photo":
        return luma ? (
          <ObjectFrame label="Your photograph" big={big} onOpen={() => setOpen("photo")} testId="first-ten-object-photo" corrected={!live(luma.finding)}>
            <Photograph src={picture} caption={luma.name} />
          </ObjectFrame>
        ) : null;
      case "notebook":
        return ilex && request?.payload.kind === "request" ? (
          <ObjectFrame label="Sable's notebook" big={big} onOpen={() => setOpen("notebook")} testId="first-ten-object-notebook" corrected={!live(ilex.finding)}>
            <NotebookPage who={request.payload.from.name ?? request.payload.from.address} at={request.payload.at} />
          </ObjectFrame>
        ) : null;
    }
  }

  const openFindings: FindingView[] = (() => {
    switch (open) {
      case "rule":
        return sable ? [sable.finding] : [];
      case "map":
        return [...(mara?.findings ?? []), ...(orren ? [orren.finding] : [])];
      case "strips":
        return rook ? [rook.finding] : [];
      case "cards":
        return bront ? [bront.finding] : [];
      case "photo":
        return luma ? [luma.finding] : [];
      case "notebook":
        return ilex ? [ilex.finding] : [];
      default:
        return [];
    }
  })();

  const speaker = aside ? aside.who : current ? current.companion : null;
  const line = aside
    ? aside.line
    : !current
      ? null
      : beat === 0
        ? null
        : beat === 1
          ? lines[0] ?? null
          : beat === 2
            ? after ?? lines[1] ?? null
            : null;
  const settled = [...new Set(seen.map(who => OBJECT_OF[who]))].filter(key => !stageObjects.includes(key));
  const sceneRef = useRef<HTMLDivElement>(null);

  return (
    <section className={styles.scene} data-testid="first-ten-crew-scene" data-current={current?.companion ?? "none"} ref={sceneRef}>
      <div className={styles.weekRow}>{sableShown ? <WeekStrip routeDay={orren ? orren.weekday : null} closedDays={rules.closedDays} /> : null}</div>
      <LayoutGroup>
        <div className={styles.desk}>
          <div className={styles.side} data-side="left">
            {settled.filter(key => SIDE[key] === "left").map(key => (
              <motion.div key={key} layoutId={`object-${key}`} className={styles.slot}>
                {renderObject(key, false)}
              </motion.div>
            ))}
          </div>
          <div className={styles.stage}>
            {/* the shared layoutId carries an object from the stage to its place at the side; no exit copy lingers */}
            {stageObjects.map(key => (
              <motion.div key={key} layoutId={`object-${key}`} className={styles.slot} initial={reduce ? false : { opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
                {renderObject(key, true)}
              </motion.div>
            ))}
            {current?.companion === "sable" && beat >= 1 && sableWaiting && !after && !changing ? (
              <motion.div className={styles.answers} initial={{ opacity: 0 }} animate={{ opacity: 1 }} data-testid="first-ten-sable-answers">
                <button type="button" disabled={answering} onClick={() => void answerSable("confirm")}>
                  {current.kind === "rule" ? "Still the rule" : "Still on"}
                </button>
                <span aria-hidden="true">·</span>
                <button type="button" disabled={answering} onClick={() => setChanging(true)}>
                  That's changed
                </button>
              </motion.div>
            ) : null}
            {current?.companion === "sable" && changing && !after ? (
              <motion.form
                className={styles.changeForm}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onSubmit={event => {
                  event.preventDefault();
                  void answerSable("change", newRule.trim() || undefined);
                }}
              >
                <label>
                  What's true now? <small>(optional)</small>
                  <input value={newRule} maxLength={300} onChange={event => setNewRule(event.target.value)} autoFocus />
                </label>
                <button type="submit" disabled={answering}>
                  Save
                </button>
              </motion.form>
            ) : null}
            {!current && !final ? <p className={styles.waiting}>{view.stage ? UNDERSTANDING_COPY[view.stage] : null}</p> : null}
          </div>
          <div className={styles.side} data-side="right">
            {settled.filter(key => SIDE[key] === "right").map(key => (
              <motion.div key={key} layoutId={`object-${key}`} className={styles.slot}>
                {renderObject(key, false)}
              </motion.div>
            ))}
          </div>
        </div>
      </LayoutGroup>
      {current?.companion === "ilex" || seen.includes("ilex") ? <Thread container={sceneRef} beat={`${current?.companion}:${beat}:${seen.length}`} /> : null}
      <CrewEdge present={present} speaker={speaker} line={line} />
      {open ? (
        <FindingNote
          findings={openFindings}
          onClose={() => setOpen(null)}
          onCorrect={async (finding, answer, correction) => {
            await correct(finding, answer, correction);
            setOpen(null);
          }}
        />
      ) : null}
    </section>
  );
}

/** Ilex's red thread, from the place on the map to the older conversation in Sable's notebook. */
function Thread({ container, beat }: { container: React.RefObject<HTMLDivElement | null>; beat: string }) {
  const [path, setPath] = useState<string | null>(null);
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      const root = container.current;
      const from = root?.querySelector('[data-thread-anchor="pin"]');
      const to = root?.querySelector('[data-thread-anchor="notebook"]');
      if (!root || !from || !to) return setPath(null);
      const box = root.getBoundingClientRect();
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const x1 = a.left + a.width / 2 - box.left;
      const y1 = a.top + a.height / 2 - box.top;
      const x2 = b.left + b.width / 2 - box.left;
      const y2 = b.top + b.height / 2 - box.top;
      const sag = Math.max(40, Math.abs(x2 - x1) * 0.25);
      setPath(`M ${x1} ${y1} C ${x1 + (x2 - x1) * 0.3} ${y1 + sag}, ${x1 + (x2 - x1) * 0.7} ${y2 + sag}, ${x2} ${y2}`);
    };
    const settle = window.setTimeout(measure, 650);
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
    };
  }, [container, beat]);
  if (!path) return null;
  return (
    <svg className={styles.threadLayer} aria-hidden="true" data-testid="first-ten-thread">
      <motion.path d={path} className={styles.thread} initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: "easeInOut" }} />
    </svg>
  );
}
