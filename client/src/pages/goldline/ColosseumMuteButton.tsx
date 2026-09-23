import { useState } from "react";
import { getAudioManager } from "../../game/audio/AudioManager";

/** A compact speaker toggle, so the HUD's top row belongs to the fight. */
export function ColosseumMuteButton() {
  const [muted, setMuted] = useState(() => getAudioManager().isMuted);
  return (
    <button
      type="button"
      className="cz-mute"
      onClick={() => {
        getAudioManager().setMuted(!muted);
        setMuted(!muted);
      }}
      aria-pressed={muted}
      aria-label={muted ? "Sound off — turn sound on" : "Sound on — mute"}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
        {muted ? (
          <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        ) : (
          <path
            d="M16 8.5c1.2 1 1.8 2.2 1.8 3.5s-.6 2.5-1.8 3.5M18.6 6c2 1.6 3 3.6 3 6s-1 4.4-3 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        )}
      </svg>
    </button>
  );
}
