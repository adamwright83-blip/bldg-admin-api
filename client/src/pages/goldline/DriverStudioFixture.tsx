import { useEffect, useRef, useState } from "react";
import type { ExternalOperationalOrder } from "@shared/externalOperationalOrder";
import type { PickupCounts } from "@shared/cleancloudPickup";
import GoldlineDayPlan from "./GoldlineDayPlan";

/**
 * Test-harness route for Driver Studio (VITE_GOLDLINE_TEST_HARNESS only).
 * Synthetic customers and addresses; every write is a local mock recorded on
 * document.body.dataset.studioMutations. `?studioFailOnce=1` makes the first
 * write fail like a dropped connection.
 */
const job = (
  id: string,
  jobKind: "pickup" | "dropoff",
  customerName: string,
  address: string,
  windowStart: string,
  windowEnd: string,
  bridge: boolean
): ExternalOperationalOrder => ({
  id,
  sourceSystem: "cleancloud",
  ingestionMethod: "browser",
  externalOrderId: id.replace(/\D/g, "") || "1",
  jobKind,
  customerName,
  address,
  scheduledDate: "2026-08-25",
  windowStart,
  windowEnd,
  notes: null,
  operationalStatus: "scheduled",
  completedAt: null,
  reconciliationStatus: "update_required",
  reconciledAt: null,
  reviewState: "confirmed",
  importBatchId: null,
  createdAt: "2026-08-25T12:00:00Z",
  pickupBridge: bridge
    ? { state: "ready", bagCount: null, garmentCount: null, observedAt: "2026-08-25T12:00:00Z", verifiedAt: null, error: null }
    : undefined,
});

const INITIAL: ExternalOperationalOrder[] = [
  job("studio-1", "pickup", "Avery Example", "2170 Century Park East, Los Angeles, CA 90067", "11:00", "12:00", true),
  job("studio-2", "dropoff", "Briar Example", "2170 Century Park East, Los Angeles, CA 90067", "11:00", "12:00", false),
  job("studio-3", "pickup", "Casey Example", "3545 Wilshire Blvd, Los Angeles, CA 90010", "14:00", "15:00", true),
  job("studio-4", "dropoff", "Devon Example", "9500 Example Drive, Beverly Hills, CA 90210", "18:30", "19:30", false),
];

/** `?studioScenes=all` adds one synthetic stop per remaining scene for visual QA. */
const SCENE_TOUR: ExternalOperationalOrder[] = [
  job("studio-5", "dropoff", "Emery Example", "1 Example Court, Silver Lake, Los Angeles, CA 90026", "15:30", "16:30", false),
  job("studio-6", "dropoff", "Finley Example", "10 Example Street, Koreatown, Los Angeles, CA 90005", "16:00", "17:00", false),
  job("studio-7", "dropoff", "Gray Example", "20 Example Avenue, Hollywood, Los Angeles, CA 90028", "17:30", "18:00", false),
  job("studio-8", "dropoff", "Harper Example Cleaners", "30 Example Road, Los Angeles, CA 90029", "18:00", "18:30", false),
];

export default function DriverStudioFixture() {
  const [jobs, setJobs] = useState(() =>
    new URLSearchParams(window.location.search).get("studioScenes") === "all" ? [...INITIAL, ...SCENE_TOUR] : INITIAL
  );
  const failOnce = useRef(new URLSearchParams(window.location.search).get("studioFailOnce") === "1");
  useEffect(() => {
    const mark = () => { document.body.dataset.claireComposer = "open"; };
    window.addEventListener("joystick:claire-composer-open", mark);
    return () => window.removeEventListener("joystick:claire-composer-open", mark);
  }, []);
  const record = (entry: Record<string, unknown>) => {
    const list = JSON.parse(document.body.dataset.studioMutations ?? "[]");
    list.push(entry);
    document.body.dataset.studioMutations = JSON.stringify(list);
  };
  async function resolve(stop: { action?: { type: string; id?: string } }, counts?: PickupCounts) {
    const id = stop.action?.type === "external" ? stop.action.id : undefined;
    if (!id) return false;
    await new Promise(r => setTimeout(r, 350));
    if (failOnce.current) {
      failOnce.current = false;
      record({ id, failed: true });
      throw new Error("Network unavailable");
    }
    record({ id, counts: counts ?? null });
    setJobs(current =>
      current.map(j =>
        j.id === id
          ? {
              ...j,
              operationalStatus: "completed",
              completedAt: new Date().toISOString(),
              pickupBridge: j.pickupBridge && counts ? { ...j.pickupBridge, ...counts, state: "pending" } : j.pickupBridge,
            }
          : j
      )
    );
    return true;
  }
  return (
    <GoldlineDayPlan
      businessDate="2026-08-25"
      externalOrders={jobs}
      onResolveStop={resolve}
      onRetryPickup={async () => {}}
      onOpenImport={() => {}}
      onOpenNewOrder={() => { document.body.dataset.newOrderOpened = "true"; }}
      onCallClaire={async () => { document.body.dataset.claireCalled = "true"; }}
      onEnterOperations={() => {}}
      onEnterWorld={() => {}}
      onEnterColosseum={() => {}}
    />
  );
}
