import type { GoldlineClientEventName } from "../../../../shared/dayforgeEvents";

/**
 * Fire-and-forget analytics dispatch. Gameplay must never be blocked or
 * altered by an analytics failure — a rejected promise here is caught and
 * discarded, never surfaced to the player or allowed to affect game state.
 */
export type GoldlineEventEmitter = (input: {
  eventName: GoldlineClientEventName;
  sessionId: string;
  missionId?: number | null;
  properties?: Record<string, string | number | boolean>;
}) => void;

export function createGoldlineEventEmitter(
  record: (input: {
    sessionId: string;
    eventId: string;
    eventName: GoldlineClientEventName;
    missionId?: number | null;
    properties: Record<string, string | number | boolean>;
  }) => Promise<unknown>
): GoldlineEventEmitter {
  return input => {
    void record({
      sessionId: input.sessionId,
      eventId: crypto.randomUUID(),
      eventName: input.eventName,
      missionId: input.missionId ?? null,
      properties: input.properties ?? {},
    }).catch(() => {
      // Analytics is best-effort; swallow so a dropped event never surfaces
      // as a game error or blocks the encounter.
    });
  };
}
