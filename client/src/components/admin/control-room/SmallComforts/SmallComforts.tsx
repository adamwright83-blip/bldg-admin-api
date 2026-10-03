import { useEffect, useRef, useState } from "react";
import { Game } from "./game/game";
import { SMALL_COMFORTS_MARKUP } from "./markup";
import "./smallComforts.css";

/**
 * Small Comforts: the playable room inside Lantern City's lost-property suitcase.
 * Mounted full-screen over the city once you've zoomed to Hollywood and into the suitcase.
 * The game owns its own DOM and WebGL context; leaving disposes both.
 */
export default function SmallComforts({ onExit }: { onExit: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const exit = useRef(onExit);
  exit.current = onExit;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    const ui = document.createElement("div");
    ui.className = "sc-root";
    ui.dataset.phase = "title";
    ui.innerHTML = SMALL_COMFORTS_MARKUP;
    mount.appendChild(ui);
    let game: Game | null = null;
    try {
      game = new Game(ui.querySelector<HTMLElement>("#app")!, ui, { onExit: () => exit.current(), autoStart: true });
    } catch (e) {
      console.warn("Small Comforts needs WebGL", e);
      setFailed(true);
    }
    return () => { game?.dispose(); ui.remove(); };
  }, []);

  return (
    <div ref={host} data-small-comforts="">
      {failed ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, display: "grid", placeItems: "center", background: "#8EC5FF", color: "#2f5f7a", font: "18px system-ui", textAlign: "center", padding: 24 }}>
          <div>
            Small Comforts needs WebGL.
            <div><button type="button" onClick={onExit} style={{ marginTop: 16, padding: "10px 18px" }}>Back to Lantern City</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
