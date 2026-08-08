import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import GoldlineHome from "./pages/goldline/GoldlineHome";

const root = document.getElementById("root");

if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <GoldlineHome />
  </StrictMode>
);
