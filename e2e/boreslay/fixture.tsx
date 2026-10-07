import React from "react";
import { createRoot } from "react-dom/client";
import RallyDemo from "../../client/src/components/boreslay-rally/RallyDemo";

Object.assign(window, { React });
createRoot(document.getElementById("root")!).render(<RallyDemo />);
