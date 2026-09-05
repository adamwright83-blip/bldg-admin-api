import type { Order } from "@shared/types";
import type { CommercialMission } from "@shared/commercialMission";
import type { ExternalOperationalOrder } from "@shared/externalOperationalOrder";
import GoldlineDayPlan from "./GoldlineDayPlan";
import { useState } from "react";
import type { DayDirectorCommitment } from "@shared/dayDirector";
import type { VehicleCargoItem } from "@/components/goldline/VehicleCargo";

export default function GoldlineDayPlanFixture({ state }: { state: string }) {
  const storagePrefix = `day-director-${state}`;
  const [commitments, setCommitments] = useState<DayDirectorCommitment[]>(() =>
    JSON.parse(sessionStorage.getItem(`${storagePrefix}-commitments`) ?? "[]")
  );
  const [dismissed, setDismissed] = useState<string[]>(() =>
    JSON.parse(sessionStorage.getItem(`${storagePrefix}-dismissed`) ?? "[]")
  );
  const order = (
    id: number,
    kind: "pickup" | "dropoff",
    name: string,
    window: string,
    status: Order["status"] = "new"
  ) =>
    ({
      id,
      firstName: name,
      lastName: "",
      address: `${id} Goldline Way`,
      pickupTimeWindow: kind === "pickup" ? window : "",
      deliveryTimeWindow: kind === "dropoff" ? window : null,
      status,
      paid: true,
      updatedAt: new Date("2026-08-25T17:14:00.000Z"),
    }) as Order;
  const imported: ExternalOperationalOrder[] =
    state === "morning"
      ? []
      : [
          {
            id: "cleancloud-evergreen",
            sourceSystem: "cleancloud",
            ingestionMethod: "screenshot",
            externalOrderId: "CC-112",
            jobKind: "dropoff",
            customerName: "Evergreen CPAs",
            address: "112 Evergreen Lane",
            scheduledDate: "2026-08-25",
            windowStart: "10:30",
            windowEnd: "11:30",
            notes: null,
            operationalStatus: state === "active" ? "completed" : "scheduled",
            completedAt: state === "active" ? "2026-08-25T18:12:00.000Z" : null,
            reconciliationStatus: "update_required",
            reconciledAt: null,
            reviewState: "confirmed",
            importBatchId: "fixture",
            createdAt: "2026-08-25T16:00:00.000Z",
          },
        ];
  const mission = {
    id: 6,
    code: "GREYSTAR-6",
    status: state === "active" ? "game_ready" : "selected",
    account: { name: "Greystar 6", address: "6 Kingdom Road" },
    steps: [],
    expiresAt: null,
    completedAt: null,
  } as CommercialMission;
  const cargo: VehicleCargoItem[] = state === "morning" ? [] : [
    { id: 101, firstName: "Avery", lastName: "Stone", state: "IN_VEHICLE_UNPROCESSED", appearance: { kind: "paper_bag", condition: "scrunched garments", next: "Processor handoff" } },
    { id: 102, firstName: "Morgan", lastName: "Lane", state: "IN_VEHICLE_PROCESSED", appearance: { kind: "garment_bag", condition: "covered garments", next: "Customer return" } },
    { id: 103, firstName: "Jordan", lastName: "Pike", state: "IN_VEHICLE_UNPROCESSED", appearance: { kind: "paper_bag", condition: "scrunched garments", next: "Processor handoff" } },
    { id: 104, firstName: "Riley", lastName: "Vale", state: "IN_VEHICLE_PROCESSED", appearance: { kind: "garment_bag", condition: "covered garments", next: "Customer return" } },
    { id: 105, firstName: "Casey", lastName: "North", state: "IN_VEHICLE_UNPROCESSED", appearance: { kind: "paper_bag", condition: "scrunched garments", next: "Processor handoff" } },
  ];
  return (
    <GoldlineDayPlan
      businessDate="2026-08-25"
      cargoFixture={cargo}
      pickups={[
        order(
          1,
          "pickup",
          "Brightline Builders",
          "9:00–10:00",
          state === "active" ? "collected" : "new"
        ),
        order(5, "pickup", "Sunset Towers", "1:30–2:30"),
      ]}
      deliveries={[order(6, "dropoff", "Park Meridian", "3:00–4:00", "ready")]}
      externalOrders={imported}
      salesMissions={state.startsWith("director") ? [] : [mission]}
      processingLocation={{
        name: "Lugo's Lavanderia",
        locality: "Huntington Park",
        address: null,
      }}
      commitments={commitments}
      intelligenceAvailable={!state.startsWith("director-fallback")}
      dismissedPromptKeys={dismissed}
      onProposeCommitment={async sourceText => ({
        promptKey: "fixture-postcards",
        title: state.startsWith("director-fallback")
          ? sourceText
          : "Mail customer postcards",
        kind: "growth",
        quantity: state.startsWith("director-fallback") ? null : 4,
        sourceText,
        prerequisites: state.startsWith("director-fallback")
          ? []
          : ["postcards available"],
        question: state.startsWith("director-fallback")
          ? null
          : "Do you already have the postcards with you?",
        intelligence: state.startsWith("director-fallback")
          ? "manual_fallback"
          : "anthropic",
      })}
      onAcceptProposal={async proposal =>
        setCommitments(current => {
          const next = current.some(item => item.id === proposal.promptKey)
            ? current
            : [
                ...current,
                {
                  id: proposal.promptKey,
                  businessDate: "2026-08-25",
                  title: proposal.title,
                  kind: proposal.kind,
                  quantity: proposal.quantity,
                  provenance: "user_reported",
                  status: "open",
                  completedAt: null,
                },
              ];
          sessionStorage.setItem(
            `${storagePrefix}-commitments`,
            JSON.stringify(next)
          );
          return next;
        })
      }
      onDismissProposal={async promptKey => {
        const next = [...new Set([...dismissed, promptKey])];
        setDismissed(next);
        sessionStorage.setItem(
          `${storagePrefix}-dismissed`,
          JSON.stringify(next)
        );
      }}
      nextCommitmentAt={
        state === "active"
          ? new Date(Date.now() + 3 * 60 * 60_000).toISOString()
          : new Date(Date.now() + 30 * 60_000).toISOString()
      }
      openChannelMission={{
        id: "fixture-briefing",
        businessDate: "2026-08-25",
        status: "active",
        title: "Today's preparation",
        operatorBriefing: "",
        transcript: "",
        generationSource: "deterministic_fallback",
        gapStartedAt: "2026-08-25T15:00:00.000Z",
        nextCommitmentAt: null,
        availableMinutes: 180,
        approvedAt: "2026-08-25T15:00:00.000Z",
        completedAt: null,
        tasks: [
          {
            id: "print",
            position: 0,
            title: "Print collateral",
            detail: "",
            estimatedMinutes: 15,
            category: "operations",
            navigationQuery: null,
            status: "pending",
            completedAt: null,
          },
          {
            id: "wardrobe",
            position: 1,
            title: "Prepare wardrobe",
            detail: "",
            estimatedMinutes: 10,
            category: "personal",
            navigationQuery: null,
            status: "pending",
            completedAt: null,
          },
        ],
      }}
      onOpenImport={() => {
        document.body.dataset.importOpened = "true";
      }}
      onEnterOperations={() => {
        document.body.dataset.operationsEntered = "true";
      }}
      onEnterWorld={() => {
        document.body.dataset.worldEntered = "true";
      }}
      onEnterColosseum={() => {
        document.body.dataset.colosseumEntered = "true";
      }}
    />
  );
}
