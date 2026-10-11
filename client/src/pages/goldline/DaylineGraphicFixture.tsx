/** Compile-time test harness only; never imported by a production build. */
import { useEffect, useState } from "react";
import type { Order } from "@shared/types";
import GoldlineDayPlan from "./GoldlineDayPlan";
import type {
  DayPlanStopKind,
  LiveAdventureObjective,
} from "../driver/goldlineDayPlanModel";

export default function DaylineGraphicFixture({ state }: { state: string }) {
  const [loaded, setLoaded] = useState(false);
  const [completed, setCompleted] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 450);
    return () => clearTimeout(timer);
  }, []);
  const kinds: DayPlanStopKind[] =
    state === "art-one"
      ? ["pickup"]
      : state === "art-three"
        ? ["pickup", "sales", "dropoff"]
        : state === "art-sales"
          ? ["sales", "sales", "sales", "sales"]
          : state === "art-eight-sales"
            ? Array(8).fill("sales")
            : state === "art-eight"
              ? [
                  "pickup",
                  "sales",
                  "sales",
                  "dropoff",
                  "growth",
                  "marketing",
                  "pickup",
                  "dropoff",
                ]
              : ["pickup", "sales", "dropoff", "growth", "marketing"];
  const pickups: Order[] = [],
    deliveries: Order[] = [],
    liveObjectives: LiveAdventureObjective[] = [];
  const ids: string[] = [];
  kinds.forEach((kind, index) => {
    const id = 900 + index;
    const title =
      state === "art-long"
        ? `The Very Long Customer and Property Management Company Name ${index + 1}`
        : [
            "North Terrace",
            "Los Feliz Towers",
            "John Liang",
            "Follow up with Briana",
            "Publish prepared campaign",
          ][index % 5];
    const address =
      state === "art-missing"
        ? null
        : state === "art-long"
          ? "4455 Los Feliz Boulevard, Building Seven, Suite 107, Los Angeles, California 90027, United States"
          : "4455 Los Feliz Blvd #107, Los Angeles, CA 90027";
    const done =
      (state === "art-completed" && index % 2 === 0) ||
      (completed && index === 0);
    if (kind === "pickup" || kind === "dropoff") {
      ids.push(`native-${kind}-${id}`);
      const order = {
        id,
        firstName: title,
        lastName: "",
        address: address ?? "",
        pickupTimeWindow: `${8 + index}:00 AM`,
        deliveryTimeWindow: `${8 + index}:00 AM`,
        status: done ? (kind === "pickup" ? "collected" : "delivered") : "new",
        paid: true,
        updatedAt: new Date("2026-10-10T18:00:00Z"),
      } as Order;
      (kind === "pickup" ? pickups : deliveries).push(order);
    } else if (kind === "sales" || kind === "growth" || kind === "marketing") {
      ids.push(`living-world-fixture-${id}`);
      liveObjectives.push({
        id: `fixture-${id}`,
        kind,
        title,
        address,
        dueAt: `2026-10-10T${String(15 + index).padStart(2, "0")}:00:00Z`,
        status: done ? "completed" : "ready",
        sourceLabel: "Fixture",
        latitude: null,
        longitude: null,
        physicalEntityId: null,
        explanation: "Test data only",
        sourceEvidenceReference: `fixture:${id}`,
        sourceOccurredAt: null,
      });
    }
  });
  return (
    <>
      <GoldlineDayPlan
        businessDate="2026-10-10"
        pickups={loaded ? pickups : []}
        deliveries={loaded ? deliveries : []}
        liveObjectives={loaded ? liveObjectives : []}
        campaignChapters={[{ objectiveIds: ids }]}
        isLoading={!loaded}
        isDriving={false}
        allowWalkingAnimation
        onOpenImport={() => {}}
        onEnterOperations={() => {}}
        onEnterColosseum={() => {}}
        onEnterWorld={id => {
          document.body.dataset.fixtureSelected = id ?? "world";
        }}
      />
      <button
        data-testid="fixture-record-completion"
        onClick={() => setCompleted(true)}
        style={{
          position: "fixed",
          left: 0,
          bottom: 0,
          zIndex: 99,
          opacity: 0.01,
          width: 44,
          height: 44,
        }}
        aria-label="Record fixture completion"
      >
        Fixture completion
      </button>
    </>
  );
}
