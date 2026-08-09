import GoldlineHome from "@/pages/goldline/GoldlineHome";
import "@/pages/goldline/goldline-legibility.css";
import "@/pages/goldline/goldline-live-fix.css";
import { useState } from "react";

function localYmd(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Visual archive only. It deliberately receives no live operational records. */
export default function ArchivedLaraCroftSkin() {
  const [selectedDate, setSelectedDate] = useState(() => localYmd());

  return (
    <GoldlineHome
      pickups={[]}
      deliveries={[]}
      salesMissions={[]}
      selectedDate={selectedDate}
      onSelectedDateChange={setSelectedDate}
    />
  );
}
