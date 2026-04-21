/**
 * Adapter shapes consumed by the seven Tactical Noir screens. The reducer and
 * TRPC layer are canonical; these types exist so the ported screens can stay
 * close to the prototype while the switchboard in `DriverPrepMechanic.tsx`
 * translates between real state and these view shapes.
 */

export type GameOrderType = "PICKUP" | "DELIVERY";

export type GameOrder = {
  id: number;
  type: GameOrderType;
  customerName: string;
  address: string;
  items: number;
  timeWindow: string;
  nextStatus: "collected" | "delivered";
  unit: string | null;
  buildingName: string | null;
  dateLabel: string;
};

export type GameMissionTarget = {
  label: string;
  address: string | null;
  mapsUrl: string | null;
  intel: string;
  distance: string;
  reward: number;
  kind: "real" | "fallback";
};

export type GameStateSnapshot = {
  scansCompleted: number;
  laundryScore: number;
  overrideSuccess: boolean | null;
  totalXP: number;
  streak: number;
  missionsCompleted: number;
  missionNumber: number;
  payloadCount: number;
  currentPayloadIndex: number;
  missionCompletedForDay: boolean;
};
