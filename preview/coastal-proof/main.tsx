import { createRoot } from "react-dom/client";
import CoastalMarketProofPage from "@/pages/goldline/coastalMarketProof/CoastalMarketProofPage";

/**
 * Standalone harness for the Coastal Market proof (vite.coastal-proof-preview.config.ts).
 * Same page component as /goldline/coastal-market-proof; assets are served
 * next to index.html. Query parameters: ?autowalk=1, ?shot=overlook|descent|waterfront, ?perf=1.
 */
createRoot(document.getElementById("root")!).render(<CoastalMarketProofPage assetBase="./" />);
