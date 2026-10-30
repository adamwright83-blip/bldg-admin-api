import type { ChapterOpportunity, EstimateTrays } from "@shared/firstTenMinutesChapter";
import type { PlacePin } from "@shared/firstTenMinutesCrew";
import { PlacesMap } from "../crew/objects";
import { sourceDate } from "../SourceNote";
import styles from "./send.module.css";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * "A newly opened route remains on the map. The original message stays pinned beside it." Nina's map as her chapter
 * left it: today's route with the crossing open, any day she keeps closed still folded, and the old request pinned.
 */
export function TodayMap({ opportunity, businessName, closedDays }: { opportunity: ChapterOpportunity; businessName: string | null; closedDays: number[] }) {
  const pins: PlacePin[] =
    opportunity.place && opportunity.place.lat !== null && opportunity.place.lng !== null
      ? [{ findingId: opportunity.place.findingId, name: opportunity.place.name, lat: opportunity.place.lat, lng: opportunity.place.lng, asked: null }]
      : [];
  const route = (opportunity.route?.stops ?? []).map(stop => ({ label: stop.label, location: "", lat: stop.lat, lng: stop.lng }));
  return (
    <div className={styles.keptMap} data-testid="first-ten-today-map-kept">
      {pins.length ? (
        <PlacesMap
          title={businessName}
          pins={pins}
          unpinned={[]}
          clustered={false}
          route={route}
          highlight={opportunity.place?.findingId ?? null}
          showRoute
          threadFrom={null}
          crossing={opportunity.place ? { pinId: opportunity.place.findingId, open: true, sign: null } : null}
          keptClosed={closedDays.length ? `${WEEKDAYS[closedDays[0]].toUpperCase()} — CLOSED` : null}
        />
      ) : null}
      <div className={styles.pinnedNote} data-testid="first-ten-pinned-message">
        <p className={styles.pinnedWords}>“{opportunity.request.quote}”</p>
        <p className={styles.pinnedWho}>
          {opportunity.person.name ?? opportunity.person.address} · {sourceDate(opportunity.request.at)}
        </p>
      </div>
    </div>
  );
}

/** "Dev's workbench keeps the two-tray arrangement he chose": the estimate's rooms, on the trays the person put them on. */
export function Workbench({ trays }: { trays: EstimateTrays }) {
  return (
    <div className={styles.workbench} data-testid="first-ten-workbench">
      {(["thisJob", "later"] as const).map(tray => (
        <div key={tray} className={styles.benchTray} data-tray={tray}>
          <p className={styles.benchLabel}>{tray === "thisJob" ? "This job" : "Possible later work"}</p>
          <p className={styles.benchRooms}>{trays[tray].join(" · ")}</p>
        </div>
      ))}
    </div>
  );
}
