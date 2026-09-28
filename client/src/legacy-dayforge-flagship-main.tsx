import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import GoldlineHome from "./pages/goldline/GoldlineHome";

const root = document.getElementById("root");

if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <GoldlineHome
      location={{
        status: "unavailable",
        coordinates: null,
        accuracyMeters: null,
        reason: "Location is unavailable in the standalone preview.",
      }}
      dayResolution={null}
      selectedDate={new Date().toISOString().slice(0, 10)}
      onSelectedDateChange={() => {}}
      onResolveOrder={async () => false}
      onAcceptMove={async () => {}}
      onOpenWalkIn={() => {}}
      onOpenNewOrder={() => {}}
      onOpenJournal={() => {}}
      onResolveDay={async () => {}}
      onGenerateOpenChannel={async () => {}}
      onApproveOpenChannel={async () => {}}
      onCompleteOpenChannelTask={async () => false}
    />
  </StrictMode>
);
