import { Suspense, lazy } from "react";
import type { StoryGameModule, StoryGameProps } from "../types";

// three.js and the Century Park East set load only when this game mounts, never with the home
const MonitorDeskGame = lazy(() => import("./MonitorDeskGame"));

function MonitorDesk(props: StoryGameProps) {
  return (
    <Suspense
      fallback={
        <p className="story-host-wait" aria-live="polite">
          Switching on the monitors…
        </p>
      }
    >
      <MonitorDeskGame {...props} />
    </Suspense>
  );
}

/** Century Park East's camera wall, played from the desk. */
export const monitorDeskGame: StoryGameModule = { keys: ["cpe.monitor-desk"], Game: MonitorDesk };
