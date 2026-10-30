import { createRoot } from "react-dom/client";
import FridayCircuitRoute from "./FridayCircuitRoute";

/** The hosted preview's entry: one self-contained page, built by scripts/prototypes/build-friday-circuit.mjs. */
declare global {
  interface Window {
    __FRIDAY_CIRCUIT_ROOK__?: string;
  }
}

createRoot(document.getElementById("friday-circuit-root")!).render(<FridayCircuitRoute rookSrc={window.__FRIDAY_CIRCUIT_ROOK__} />);
