import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClaireComposer } from "./ClaireComposer";
import "./claireComposer.css";

const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="menuitem"]';
const RECHECK_MS = 150;

/**
 * True when something the operator can tap sits under the launcher. It floats on
 * document.body, above every stacking context in the game, so z-index can't keep it
 * off a menu that opens beneath it; it steps aside instead.
 */
function launcherCoversControl(launcher: HTMLElement): boolean {
  const r = launcher.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const inset = 4;
  const points: Array<[number, number]> = [
    [r.left + r.width / 2, r.top + r.height / 2],
    [r.left + inset, r.top + inset],
    [r.right - inset, r.top + inset],
    [r.left + inset, r.bottom - inset],
    [r.right - inset, r.bottom - inset],
  ];
  return points.some(([x, y]) =>
    document.elementsFromPoint(x, y).some(node => !launcher.contains(node) && node.closest(INTERACTIVE) !== null)
  );
}

/**
 * Driver entry to Claire's text line: one floating button that opens a sheet over
 * the Day Line. (Claire's portrait in the Day Line header places a phone call;
 * this is the typed line.) Portals to document.body because the Day Line's
 * `.gdp-shell { overflow: clip }` swallows fixed descendants (see ClaireAnalysisInbox).
 */
export function ClaireComposerSheet({ onTurn }: { onTurn?: () => void }) {
  const [open, setOpen] = useState(false);
  // The composer mounts on first open and then stays mounted, hidden, while the sheet is
  // closed: unmounting mid-turn would drop Claire's reply (and its saved copy) even though
  // the server may have acted on it. Screens where Claire is never opened carry no composer.
  const [everOpened, setEverOpened] = useState(false);
  const [stepAside, setStepAside] = useState(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open || typeof MutationObserver === "undefined") return;
    let timer: number | null = null;
    const check = () => {
      timer = null;
      const launcher = launcherRef.current;
      if (launcher) setStepAside(launcherCoversControl(launcher));
    };
    const schedule = () => {
      if (timer === null) timer = window.setTimeout(check, RECHECK_MS);
    };
    // Menus and panels open by adding nodes; no scroll/resize listeners (the e2e
    // listener-count gate counts those).
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [open]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      {everOpened ? (
        <div
          className="cc-scrim"
          hidden={!open}
          onClick={e => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          data-testid="claire-composer-sheet"
        >
          <div className="cc-panel" role="dialog" aria-modal="true" aria-labelledby="cc-panel-title">
            <div className="cc-panel-head">
              <div>
                <strong id="cc-panel-title">CLAIRE</strong>
                <small>Same Claire as your calls</small>
              </div>
              <button type="button" className="cc-close" aria-label="Close Claire" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <ClaireComposer variant="sheet" autoFocus={open} onTurn={onTurn} />
          </div>
        </div>
      ) : null}
      {open ? null : (
        <button
          ref={launcherRef}
          type="button"
          className="cc-launcher"
          data-step-aside={stepAside ? "true" : undefined}
          aria-hidden={stepAside || undefined}
          tabIndex={stepAside ? -1 : undefined}
          onClick={() => {
            setEverOpened(true);
            setOpen(true);
          }}
          aria-haspopup="dialog"
          data-testid="claire-composer-launcher"
        >
          <span className="cc-launcher-face" aria-hidden>
            ✦
          </span>
          Message Claire
        </button>
      )}
    </>,
    document.body
  );
}
