import { useEffect, useState } from "react";
import "./style2.css";

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";

/**
 * Viral-only close-up of Laundry Farm operations.
 *
 * The approved renderer remains authored as standalone JavaScript so the capture
 * harness and the in-app route execute the exact same scene. Entry/exit uses a
 * hard navigation on purpose: hero.js owns a WebGL animation loop and the route
 * should always start from a clean renderer.
 */
export default function LaundryOperationsFloor() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.title = "Laundry Farm — Operations Command";

    if (!document.querySelector(`link[href="${FONT_HREF}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONT_HREF;
      link.dataset.laundryFloorFont = "true";
      document.head.appendChild(link);
    }

    // hero.js is intentionally the same plain-JS module used by the capture harness.
    // @ts-ignore -- the viral capture scene is intentionally authored as JavaScript.
    void import("./hero.js").catch(error => {
      console.error("[laundry-floor] failed to start", error);
      setFailed(true);
    });
  }, []);

  return (
    <main className="laundry-floor-page" aria-label="Laundry Farm Operations Command">
      <div id="stage">
        <canvas id="gl" aria-label="Laundry operations strategy-game scene" />
        <div id="hud" />
      </div>

      <button
        type="button"
        className="laundry-floor-exit"
        onClick={() => window.location.assign("/")}
      >
        <span aria-hidden>←</span>
        <span>Lantern City</span>
      </button>

      {failed ? (
        <div className="laundry-floor-failure" role="alert">
          Operations Command could not start. Return to Lantern City and try again.
        </div>
      ) : null}
    </main>
  );
}
