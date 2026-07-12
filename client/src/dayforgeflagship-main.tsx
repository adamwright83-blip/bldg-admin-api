import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import DayforgeFlagship from "./pages/dayforge-flagship/DayforgeFlagship";

const root = document.getElementById("root");

if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <DayforgeFlagship />
  </StrictMode>
);
