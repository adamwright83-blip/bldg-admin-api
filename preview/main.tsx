import { createRoot } from "react-dom/client";
import "./index.css";
import { CockpitDemoStage } from "@/pages/TruePnlCockpitPage";
import { COCKPIT_DEMO_BEATS } from "@/pages/cockpitDemoData";

function PreviewHarness() {
  return (
    <div style={{ width: "100%", maxWidth: 1536, margin: "0 auto" }}>
      <CockpitDemoStage beats={COCKPIT_DEMO_BEATS} />
    </div>
  );
}

createRoot(document.getElementById("preview-root")!).render(<PreviewHarness />);
