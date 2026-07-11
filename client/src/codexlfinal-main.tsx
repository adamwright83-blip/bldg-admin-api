import { createRoot } from "react-dom/client";
import CodexLFinal from "./pages/codex-l-final/CodexLFinal";

const root = document.getElementById("root");

if (!root) {
  throw new Error("CodexLFinal root element was not found");
}

createRoot(root).render(<CodexLFinal />);
