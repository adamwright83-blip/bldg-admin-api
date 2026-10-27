import { useState } from "react";
import type { ExternalOperationalOrder } from "@shared/externalOperationalOrder";
import type { PickupCounts } from "@shared/cleancloudPickup";
import GoldlineDayPlan from "./GoldlineDayPlan";
const names = ["Avery Example", "Briar Example", "Casey Example"];
export default function DriverPickupFixture({
  failed = false,
}: {
  failed?: boolean;
}) {
  const [jobs, setJobs] = useState<ExternalOperationalOrder[]>(() =>
    names.map((customerName, index) => ({
      id: `fixture-pickup-${index}`,
      sourceSystem: "cleancloud",
      ingestionMethod: "browser",
      externalOrderId: String(101 + index),
      jobKind: "pickup",
      customerName,
      address: `${42 + index} Example Street, Los Angeles, CA`,
      scheduledDate: "2026-08-25",
      windowStart: `0${7 + index}:00`,
      windowEnd: "10:00",
      notes: null,
      operationalStatus: "scheduled",
      completedAt: null,
      reconciliationStatus: "update_required",
      reconciledAt: null,
      reviewState: "confirmed",
      importBatchId: null,
      createdAt: "2026-08-25T12:00:00Z",
      pickupBridge: {
        state: "ready",
        bagCount: null,
        garmentCount: null,
        observedAt: "2026-08-25T12:00:00Z",
        verifiedAt: null,
        error: null,
      },
    }))
  );
  async function resolve(
    stop: { action?: { type: string; id?: string } },
    counts?: PickupCounts
  ) {
    if (!counts || !stop.action?.id) return false;
    document.body.dataset.pickupMutation = JSON.stringify({
      id: stop.action.id,
      counts,
    });
    setJobs(current =>
      current.map(job =>
        job.id === stop.action!.id
          ? {
              ...job,
              operationalStatus: "completed",
              completedAt: new Date().toISOString(),
              pickupBridge: {
                ...job.pickupBridge!,
                ...counts,
                state: failed ? "attention" : "pending",
                error: failed ? "CleanCloud needs to sign in again." : null,
              },
            }
          : job
      )
    );
    return true;
  }
  return (
    <GoldlineDayPlan
      defaultSurface="legacy"
      businessDate="2026-08-25"
      externalOrders={jobs}
      onResolveStop={resolve}
      onRetryPickup={async stop =>
        setJobs(current =>
          current.map(job =>
            stop.action?.type === "external" && job.id === stop.action.id
              ? {
                  ...job,
                  pickupBridge: {
                    ...job.pickupBridge!,
                    state: "pending",
                    error: null,
                  },
                }
              : job
          )
        )
      }
      onOpenImport={() => {}}
      onEnterOperations={() => {}}
      onEnterWorld={() => {}}
      onEnterColosseum={() => {}}
    />
  );
}
