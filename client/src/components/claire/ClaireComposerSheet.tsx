import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ClaireComposer } from "./ClaireComposer";
import "./claireComposer.css";

/**
 * Driver entry to Claire's text line: one floating button that opens a sheet over
 * the Day Line. (Claire's portrait in the Day Line header places a phone call;
 * this is the typed line.) Portals to document.body because the Day Line's `.gdp-shell
 * { overflow: clip }` swallows fixed descendants (see ClaireAnalysisInbox).
 */
export function ClaireComposerSheet({ onTurn }: { onTurn?: () => void }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (typeof document === "undefined") return null;

  // The sheet only hides when closed. Unmounting the composer mid-turn would drop
  // Claire's reply (and its saved copy) even though the server may have acted on it.
  return createPortal(
    <>
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
      {open ? null : (
        <button
          type="button"
          className="cc-launcher"
          onClick={() => setOpen(true)}
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
