import type { CSSProperties } from "react";
import { PRODUCT_NAME } from "@shared/productIdentity";

/**
 * Shown while the Colosseum's code and painting arrive. Styled inline on
 * purpose: it renders before the lazily loaded Colosseum stylesheet exists.
 */
const shell: CSSProperties = {
  minHeight: "100dvh",
  display: "grid",
  placeContent: "center",
  textAlign: "center",
  background:
    "radial-gradient(circle at 50% 38%, rgba(255, 223, 150, 0.55), transparent 42%), linear-gradient(180deg, #8fc7ea 0%, #e8d6b0 58%, #b0936a 100%)",
  color: "#172033",
};

export function ColosseumBossLoading() {
  return (
    <div className="colosseum-loading" style={shell} aria-label="Entering the Colosseum">
      <div
        className="colosseum-loading-mark"
        style={{ font: '800 13px/1 "Barlow Condensed", system-ui, sans-serif', letterSpacing: "0.32em", color: "#7a4f14" }}
      >
        {PRODUCT_NAME}
      </div>
      <div
        className="colosseum-loading-copy"
        style={{ marginTop: 10, font: '600 clamp(26px, 8vw, 42px) / 1 "Fraunces", Georgia, serif' }}
      >
        ENTERING THE COLOSSEUM
      </div>
    </div>
  );
}
