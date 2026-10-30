import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Fragment, useState } from "react";
import type { FindingView, SourceRef } from "@shared/firstTenMinutesFindings";
import { PORTRAIT_CONTROLS, type PortraitLine, type PortraitView } from "@shared/firstTenMinutesPortrait";
import { SourceNote } from "../SourceNote";
import styles from "./portrait.module.css";

/**
 * Claire gives the whole picture its language: one page, the screenshot moment. Nothing on it explains itself.
 * "Let me change something" makes each line something to touch; the person's own words then stand on the page in
 * their hand, beside Claire's struck line, until they say it sounds like them.
 */
export function PortraitPage({
  view,
  findings,
  onKeep,
  onChange,
  onRestore,
  entry,
  children,
}: {
  view: PortraitView;
  findings: FindingView[];
  onKeep: () => Promise<void>;
  onChange: (key: string, to: string | null) => Promise<void>;
  onRestore: (key: string) => Promise<void>;
  /** a new entry on the page, once there is one (the person's first chapter) */
  entry?: React.ReactNode;
  /** what follows the page: Claire, available to ask */
  children?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const [changing, setChanging] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const kept = view.status === "kept";

  async function act(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }

  const sourcesOf = (line: PortraitLine): SourceRef[] => {
    const cited = line.findingIds.map(id => findings.find(finding => finding.id === id)).filter((finding): finding is FindingView => Boolean(finding));
    const seen = new Set<string>();
    const sources: SourceRef[] = [];
    for (const finding of cited) {
      const source = finding.sources.find(candidate => !seen.has(`${candidate.provider}:${candidate.ref}`));
      if (!source) continue;
      seen.add(`${source.provider}:${source.ref}`);
      sources.push(source);
      if (sources.length === 3) break;
    }
    return sources;
  };

  return (
    <div className={styles.stage}>
      <motion.article
        className={styles.page}
        data-testid="first-ten-portrait"
        data-status={view.status}
        initial={reduce ? false : { opacity: 0, y: 36, rotate: -0.6 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        transition={{ type: "spring", stiffness: 70, damping: 16 }}
      >
        <p className={styles.greeting}>{view.greeting}</p>
        {view.paragraphs.map((paragraph, index) => {
          const editing = paragraph.find(line => line.key === open) ?? null;
          return (
            <Fragment key={index}>
              <p className={styles.paragraph}>
                {paragraph.map(line => (
                  <Line
                    key={line.key}
                    line={line}
                    touchable={changing && !kept}
                    open={open === line.key}
                    onTouch={() => setOpen(open === line.key ? null : line.key)}
                  />
                ))}
              </p>
              <AnimatePresence>
                {editing && changing && !kept ? (
                  <LineEditor
                    key={editing.key}
                    line={editing}
                    sources={sourcesOf(editing)}
                    busy={busy}
                    onChange={to =>
                      act(async () => {
                        await onChange(editing.key, to);
                        setOpen(null);
                      })
                    }
                    onRestore={() =>
                      act(async () => {
                        await onRestore(editing.key);
                        setOpen(null);
                      })
                    }
                    onClose={() => setOpen(null)}
                  />
                ) : null}
              </AnimatePresence>
            </Fragment>
          );
        })}
        {view.closing ? <p className={styles.closing}>{view.closing.text}</p> : null}
        <div className={styles.sign}>
          <span className={styles.signature}>Claire</span>
          {kept ? (
            <motion.span
              className={styles.seal}
              aria-label="Kept"
              data-testid="first-ten-portrait-kept"
              initial={reduce ? false : { scale: 1.8, opacity: 0, rotate: -18 }}
              animate={{ scale: 1, opacity: 1, rotate: -8 }}
              transition={{ type: "spring", stiffness: 320, damping: 14 }}
            >
              C
            </motion.span>
          ) : null}
        </div>
        {entry}
      </motion.article>
      {!kept ? (
        <div className={styles.controls} data-testid="first-ten-portrait-controls">
          <button type="button" disabled={busy} onClick={() => void act(onKeep)}>
            {PORTRAIT_CONTROLS.keep}
          </button>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            aria-pressed={changing}
            onClick={() => {
              setChanging(!changing);
              setOpen(null);
            }}
          >
            {PORTRAIT_CONTROLS.change}
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}

function Line({ line, touchable, open, onTouch }: { line: PortraitLine; touchable: boolean; open: boolean; onTouch: () => void }) {
  const changed = line.changedTo !== undefined;
  const body = changed ? (
    <>
      <span className={styles.struck}>{line.text}</span>
      {line.changedTo ? <span className={styles.theirs}>{line.changedTo}</span> : null}
    </>
  ) : (
    line.text
  );
  return (
    <>
      {touchable ? (
        <button type="button" className={`${styles.line} ${styles.touchable}`} data-line={line.key} aria-expanded={open} onClick={onTouch}>
          {body}
        </button>
      ) : (
        <span className={styles.line} data-line={line.key}>
          {body}
        </span>
      )}{" "}
    </>
  );
}

function LineEditor({
  line,
  sources,
  busy,
  onChange,
  onRestore,
  onClose,
}: {
  line: PortraitLine;
  sources: SourceRef[];
  busy: boolean;
  onChange: (to: string | null) => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  const [words, setWords] = useState(line.changedTo ?? "");
  return (
    <motion.div
      className={styles.editor}
      data-testid="first-ten-portrait-editor"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
    >
      <div className={styles.editorInner}>
        {sources.length ? <SourceNote sources={sources} /> : null}
        <label className={styles.editorLabel}>
          What's true instead?
          <textarea value={words} maxLength={400} rows={2} onChange={event => setWords(event.target.value)} autoFocus />
        </label>
        <div className={styles.editorActions}>
          <button type="button" className={styles.editorMain} disabled={busy || !words.trim()} onClick={() => onChange(words.trim())}>
            Change it
          </button>
          <button type="button" disabled={busy} onClick={() => onChange(null)}>
            Take it out
          </button>
          {line.changedTo !== undefined ? (
            <button type="button" disabled={busy} onClick={onRestore}>
              Put Claire's back
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={onClose}>
            Never mind
          </button>
        </div>
      </div>
    </motion.div>
  );
}
