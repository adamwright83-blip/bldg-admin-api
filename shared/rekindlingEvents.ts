/**
 * Rekindling Arsenal ↔ Goldline world events.
 *
 * `rekindlingArsenal.ts` holds the truth model (tools, states, cooldowns).
 * This module is the seam to the event log: what a tool use writes, and how
 * a customer's rekindling state is read back from real events since the
 * operation began. The state is derived every time; nothing stores it.
 *
 * Rules:
 * - The event's verification class comes from the tool's truth class, capped
 *   by delivery evidence. An operator-reported send is ATTESTED even for a
 *   tool that could be system-sent. An offer is CLAIMED until redeemed.
 * - Only action and outcome events carry funnel meaning. Metadata may
 *   describe an event; it may never raise its impact class.
 * - There is no response-class business event yet, so ember is unreachable
 *   until one exists. That is the rule, not a gap: a send is a spark only.
 */
import { isStrongerImpactClass, type ImpactClass } from "./impactSignal";
import {
  ARSENAL_TOOLS,
  rekindlingStateFor,
  type ArsenalToolId,
  type RekindlingState,
} from "./rekindlingArsenal";

export type EventVerificationClass = "VERIFIED" | "ATTESTED" | "CLAIMED";

export function verificationClassForToolUse(input: {
  tool: ArsenalToolId;
  providerDeliveryVerified: boolean;
}): EventVerificationClass {
  switch (ARSENAL_TOOLS[input.tool].truthClass) {
    case "system_sent":
      return input.providerDeliveryVerified ? "VERIFIED" : "ATTESTED";
    case "attested":
      return "ATTESTED";
    case "redeemable":
      return "CLAIMED";
  }
}

/** Fields the outreach world event carries for a tool use. */
export function arsenalOutreachEventFields(input: {
  tool: ArsenalToolId;
  providerDeliveryVerified: boolean;
}): {
  verificationClass: EventVerificationClass;
  metadata: {
    arsenalTool: ArsenalToolId;
    truthClass: (typeof ARSENAL_TOOLS)[ArsenalToolId]["truthClass"];
    impactClass: "field_activity";
    providerDeliveryVerified: boolean;
  };
} {
  return {
    verificationClass: verificationClassForToolUse(input),
    metadata: {
      arsenalTool: input.tool,
      truthClass: ARSENAL_TOOLS[input.tool].truthClass,
      impactClass: "field_activity",
      providerDeliveryVerified: input.providerDeliveryVerified,
    },
  };
}

/** Impact class by event type. Absent types carry no funnel meaning. */
const EVENT_IMPACT: Readonly<Record<string, ImpactClass>> = {
  recovery_outreach_completed: "field_activity",
  text_sent: "field_activity",
  call_completed: "field_activity",
  email_sent: "field_activity",
  collateral_delivered: "field_activity",
  customer_recovered: "customer_outcome",
  order_paid: "economic_outcome",
};

export type RekindlingEvent = {
  eventType: string;
  classification: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

export function impactClassForRekindlingEvent(
  event: RekindlingEvent
): ImpactClass | null {
  if (event.classification !== "action" && event.classification !== "outcome")
    return null;
  return EVENT_IMPACT[event.eventType] ?? null;
}

export type RekindlingToolUse = { tool: ArsenalToolId; occurredAt: string };

export type RekindlingDerivation = {
  state: RekindlingState;
  /** Highest impact class reached since `since`. */
  reached: ImpactClass | null;
  lastToolUse: RekindlingToolUse | null;
};

export function deriveRekindling(input: {
  events: readonly RekindlingEvent[];
  since: string;
}): RekindlingDerivation {
  const sinceMs = Date.parse(input.since);
  let reached: ImpactClass | null = null;
  let lastToolUse: RekindlingToolUse | null = null;
  for (const event of input.events) {
    if (Date.parse(event.occurredAt) < sinceMs) continue;
    const impact = impactClassForRekindlingEvent(event);
    if (impact && (reached == null || isStrongerImpactClass(impact, reached)))
      reached = impact;
    const tool = event.metadata.arsenalTool;
    if (
      typeof tool === "string" &&
      tool in ARSENAL_TOOLS &&
      (!lastToolUse || event.occurredAt > lastToolUse.occurredAt)
    )
      lastToolUse = { tool: tool as ArsenalToolId, occurredAt: event.occurredAt };
  }
  return { state: rekindlingStateFor(reached), reached, lastToolUse };
}
