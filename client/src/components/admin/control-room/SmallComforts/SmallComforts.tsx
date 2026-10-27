import "./smallComfortsFrame.css";

/** Served by the server from preview/small-comforts/, the canonical build (see server/_core/smallComfortsStatic.ts). */
export const SMALL_COMFORTS_SRC = "/small-comforts/index.html";

/**
 * The Tin Can House on Hollywood opens the real game: the three chapters in
 * preview/small-comforts/, framed full screen with a way back to Lantern City.
 * The game keeps its own progress in localStorage, which the frame shares.
 */
export default function SmallComforts({ onExit }: { onExit: () => void }) {
  return (
    <div className="scf-root" data-small-comforts="game">
      <iframe
        className="scf-frame"
        src={SMALL_COMFORTS_SRC}
        title="Small Comforts"
        allow="autoplay; fullscreen"
      />
      <button type="button" className="scf-exit" onClick={onExit}>
        <span aria-hidden="true">←</span>
        Lantern City
      </button>
    </div>
  );
}
