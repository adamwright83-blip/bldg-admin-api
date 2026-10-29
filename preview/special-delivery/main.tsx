import { createRoot } from "react-dom/client";
import SilverLake3D from "@/pages/goldline/silverLake3d/SilverLake3D";
import { serveQuery } from "./trpcStub";
import "@/index.css";

/**
 * Local-only harness (vite.special-delivery-preview.config.ts). Always the synthetic preview: the neighbours are
 * the labelled preview set, the correspondence desk shows the labelled Tessa Park fixture, and nothing is sent or
 * written anywhere. The courtyard's memory lives in this browser's localStorage, so a reload shows the return visit.
 *
 *   ?fresh=1   forget this browser's courtyard memory first (a first visit again)
 */
const url = new URL(window.location.href);
if (url.searchParams.get("preview") !== "synthetic") {
  url.searchParams.set("preview", "synthetic");
  window.history.replaceState(null, "", url.toString());
}
if (url.searchParams.get("fresh") === "1") {
  try {
    Object.keys(window.localStorage)
      .filter(k => k.startsWith("silverLake.courtyard.") || k.startsWith("silverLake.desk."))
      .forEach(k => window.localStorage.removeItem(k));
  } catch {
    /* nothing to forget */
  }
  url.searchParams.delete("fresh");
  window.history.replaceState(null, "", url.toString());
}

// the airmail is on in this harness; its memory is the browser's own (the synthetic preview never reads a server)
serveQuery("system.goldlineWorld.specialDelivery", () => ({ enabled: true, memory: null }));

createRoot(document.getElementById("root")!).render(<SilverLake3D onExit={() => window.location.reload()} />);
