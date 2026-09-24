import { useEffect, useMemo, useRef, useState } from "react";
import { createCoastalProof, type RuntimeHandle } from "./runtime/CoastalProofRuntime";
import { readProofParams } from "./runtime/params";
import "./coastal-market-proof.css";

/**
 * /goldline/coastal-market-proof — isolated three.js experiment.
 *
 * Phase 2 Rook Hunt candidate. This remains an isolated proof with no business
 * authority: it reads only its static assets and writes no Goldline state.
 */
type Props = { assetBase: string };

export default function CoastalMarketProofPage({ assetBase }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<RuntimeHandle | null>(null);
  const params = useMemo(() => readProofParams(window.location.search, window.location.hash), []);
  const [loaded, setLoaded] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [begun, setBegun] = useState(params.noGate);
  const [arrived, setArrived] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    createCoastalProof(host, assetBase, params, {
      onLoadProgress: f => setLoaded(f),
      onReachWaterfront: () => setArrived(true),
    })
      .then(handle => {
        if (cancelled) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
        setReady(true);
      })
      .catch(err => {
        console.error("[coastal-proof] failed to start", err);
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [assetBase, params]);

  const begin = () => {
    if (!ready) return;
    handleRef.current?.begin();
    setBegun(true);
  };

  return (
    <div className="cmp-root" data-ready={ready ? "1" : "0"} data-begun={begun ? "1" : "0"}>
      <div ref={hostRef} className="cmp-host" />
      {!params.shot && (
        <div
          className="cmp-title"
          aria-hidden={!begun}
          title="Tap to show frame timing"
          onPointerDown={e => {
            e.stopPropagation();
            handleRef.current?.togglePerf();
          }}
        >
          <span className="cmp-title-name">THE COASTAL MARKET</span>
          <span className="cmp-title-tag">THE ROOK HUNT</span>
        </div>
      )}
      {begun && !params.shot && (
        <div className={`cmp-objective${arrived ? " is-done" : ""}`}>
          {arrived ? "The cage door is open." : "Follow the cage."}
        </div>
      )}
      {error && begun && <div className="cmp-error">Could not load: {error}</div>}
      {!begun && (
        <button type="button" className="cmp-gate" onClick={begin} disabled={!ready}>
          <span className="cmp-gate-name">THE COASTAL MARKET</span>
          <span className="cmp-gate-sub">
            {error ? `Could not load: ${error}` : ready ? "Tap to begin" : `Loading ${Math.round(loaded * 100)}%`}
          </span>
          {ready && <span className="cmp-gate-hint">Run. Jump. Hold LINE on a loaded hook.</span>}
        </button>
      )}
    </div>
  );
}
