import React from "react";
import { createRoot } from "react-dom/client";
import LanternCityIslands from "../../client/src/components/admin/control-room/LanternCityIslands/LanternCityIslands";
Object.assign(window, { React });
createRoot(document.getElementById("root")!).render(<LanternCityIslands onOpenCustomer={() => {}} />);
