/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import type { GoldlineCommEvent } from "@shared/twilioFuture";

/**
 * Domain events for Goldline communications.
 *
 * Inspected and left in place:
 * - shared/legacyLegacyDayforgeEvents.ts is product analytics and excludes transcript text.
 * - server/operationsEvents.ts records order pickup and dropoff.
 * - server/agents/agentEvents.ts records agent tool calls.
 * None of those is this bus. Twilio Sync is an optional later transport,
 * not the canonical store. A transport failure does not drop the event.
 */

export type GoldlineCommEventJournal = {
  append(event: GoldlineCommEvent): void;
  list(): readonly GoldlineCommEvent[];
};

export type GoldlineCommEventTransport = {
  publish(event: GoldlineCommEvent): Promise<void>;
};

export function createMemoryCommEventJournal(): GoldlineCommEventJournal {
  const events: GoldlineCommEvent[] = [];
  return {
    append(event) {
      events.push(event);
    },
    list() {
      return events;
    },
  };
}

export function syncIsCanonicalCommState(): false {
  return false;
}

export function commEventCreatesBusinessAuthority(_event: GoldlineCommEvent): false {
  return false;
}

export async function publishGoldlineCommEvent(input: {
  event: GoldlineCommEvent;
  journal: GoldlineCommEventJournal;
  transport?: GoldlineCommEventTransport | null;
}): Promise<{ retained: true; transport: "delivered" | "failed" | "not_configured" }> {
  const retained: GoldlineCommEvent = {
    ...input.event,
    payload: { ...input.event.payload },
    canonical: "goldline_domain_event",
    syncIsCanonicalState: false,
  };
  input.journal.append(retained);
  if (!input.transport) {
    return { retained: true, transport: "not_configured" };
  }
  try {
    await input.transport.publish(retained);
    return { retained: true, transport: "delivered" };
  } catch {
    return { retained: true, transport: "failed" };
  }
}
