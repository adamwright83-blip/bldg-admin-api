/**
 * Compile-time visual comparison fixture. Imported only through Driver's
 * VITE_GOLDLINE_TEST_HARNESS gate; these sample facts never enter production.
 * The production compositor, chrome, and stop dialog render the sample.
 */
import { useState } from "react";
import { DriverStopChapter } from "@/components/goldline/DriverStopChapter";
import type { DayPlanStop } from "../driver/goldlineDayPlanModel";
import {
  ApprovedDaylineDock,
  ApprovedDaylineHeader,
} from "./ApprovedDaylineChrome";
import { DaylineWorldCompositor } from "./DaylineWorldCompositor";

const BUSINESS_DATE = "2026-10-10";

const BASE_STOP = {
  sourceLabel: "Approved artwork visual fixture",
  estimatedMinutes: null,
  status: "ready" as const,
  fixed: false,
  navigationUrl: null,
  missionTarget: null,
  completedAt: null,
};

const APPROVED_STOPS: readonly DayPlanStop[] = [
  {
    ...BASE_STOP,
    id: "approved-pickup",
    kind: "pickup",
    title: "Los Feliz Towers",
    source: "laundry_butler",
    timeLabel: "8–11 AM",
    displayDetail: "6 bags • 18 lb",
    sortKey: "08:00",
    fixed: true,
    address: "4585 Hollywood Blvd",
  },
  {
    ...BASE_STOP,
    id: "approved-dropoff",
    kind: "dropoff",
    title: "John Liang",
    source: "laundry_butler",
    timeLabel: "9–12 PM",
    displayDetail: "8 bags • 24 lb",
    sortKey: "09:00",
    fixed: true,
    address: "1624 N. Vermont Ave",
  },
  {
    ...BASE_STOP,
    id: "approved-sales",
    kind: "sales",
    title: "Greystar 6",
    source: "commercial_mission",
    timeLabel: "11 AM–2 PM",
    displayDetail: "12 units • ~$280/mo",
    sortKey: "11:00",
    fixed: true,
    address: "1850 N. Hudson Ave",
  },
  {
    ...BASE_STOP,
    id: "approved-growth",
    kind: "growth",
    title: "Text Briana",
    source: "living_world",
    timeLabel: "Flexible today",
    displayDetail: "Follow up",
    sortKey: "13:00",
    address: null,
  },
  {
    ...BASE_STOP,
    id: "approved-marketing",
    kind: "marketing",
    title: "Post Zeely Ad",
    source: "living_world",
    timeLabel: "2–5 PM",
    sortKey: "14:00",
    fixed: true,
    address: null,
  },
];

function recordFixtureAction(action: string) {
  document.body.dataset.fixtureSelected = action;
}

export default function ApprovedDaylineVisualFixture() {
  const [activeStop, setActiveStop] = useState<DayPlanStop | null>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);

  return (
    <main
      className="gdp-shell gdp-shell--v2"
      data-testid="approved-dayline-fixture"
      data-fixture-business-date={BUSINESS_DATE}
    >
      <DaylineWorldCompositor
        stops={APPROVED_STOPS}
        onSelect={setActiveStop}
        isDriving={false}
        allowWalkingAnimation={false}
        sceneHeader={
          <ApprovedDaylineHeader
            businessDate={BUSINESS_DATE}
            navigationOpen={navigationOpen}
            onToggleNavigation={() => setNavigationOpen(open => !open)}
            onCallClaire={() => recordFixtureAction("claire")}
          />
        }
        sceneFooter={
          <ApprovedDaylineDock
            navigationOpen={navigationOpen}
            onLanternCity={() => recordFixtureAction("lantern-city")}
            onDayLine={() => {
              setNavigationOpen(false);
              window.scrollTo({ top: 0 });
            }}
            onCollection={() => recordFixtureAction("collection")}
            onBriefings={() => setNavigationOpen(open => !open)}
          />
        }
      />
      {navigationOpen && (
        <div
          className="gdp-approved-navigation"
          id="goldline-world-navigation"
          aria-label="World navigation"
        >
          <div className="gdp-approved-navigation-actions">
            <button onClick={() => recordFixtureAction("world")}>
              EXPLORE OVERWORLD
            </button>
            <button onClick={() => setNavigationOpen(false)}>CLOSE</button>
          </div>
        </div>
      )}
      {activeStop && (
        <DriverStopChapter
          stop={activeStop}
          onClose={() => setActiveStop(null)}
          onEnter={() => {
            recordFixtureAction(activeStop.id);
            setActiveStop(null);
          }}
          onJournal={() => {
            recordFixtureAction("journal");
            setActiveStop(null);
          }}
          onPlay={() => {
            recordFixtureAction("play");
            setActiveStop(null);
          }}
        />
      )}
    </main>
  );
}
