/**
 * The Rekindling Arsenal — truth model for the fiction tools that wrap real
 * customer outreach.
 *
 *   Signal Flare   → personal SMS
 *   Recall Bell    → phone call
 *   Courier Sprite → postcard
 *   Golden Seal    → real offer (a discount is money)
 *
 * Three honest states between outreach and restoration, mapped onto the
 * impact ladder:
 *   spark  — outreach was sent          (field_activity)
 *   ember  — the customer really replied (response)
 *   flame  — a real order landed        (customer_outcome / economic_outcome)
 *
 * Rules enforced here, not in copy:
 * - A dormant lantern cannot pass spark on attestation alone. Only a
 *   response-class event makes an ember; only an order makes a flame.
 * - Cooldowns are real. In fiction the flare needs time to be seen. In
 *   reality it is anti-spam and consent law. Same rule, two names.
 * - The Golden Seal declares its real cost so choosing it is a decision.
 * - No tool may promise an answer. `sentLine` never says the light will answer.
 */
import type { ImpactClass } from "./impactSignal";

export type ArsenalToolId = "signal_flare" | "recall_bell" | "courier_sprite" | "golden_seal";

/** How the *send* is known to have happened. */
export type OutreachTruthClass =
  | "system_sent" // sent through Goldline (e.g. Twilio); provable
  | "attested" // operator says they did it; recorded as attestation
  | "redeemable"; // the response verifies itself on redemption (offer code)

export type ArsenalTool = {
  id: ArsenalToolId;
  fictionName: string;
  realAction: string;
  truthClass: OutreachTruthClass;
  /** Minimum business days between uses on the same customer. */
  cooldownDays: number;
  /** True when using the tool spends real margin. */
  costsMoney: boolean;
};

export const ARSENAL_TOOLS: Record<ArsenalToolId, ArsenalTool> = {
  signal_flare: {
    id: "signal_flare",
    fictionName: "Signal Flare",
    realAction: "personal text message",
    truthClass: "system_sent",
    cooldownDays: 7,
    costsMoney: false,
  },
  recall_bell: {
    id: "recall_bell",
    fictionName: "Recall Bell",
    realAction: "phone call",
    truthClass: "attested",
    cooldownDays: 7,
    costsMoney: false,
  },
  courier_sprite: {
    id: "courier_sprite",
    fictionName: "Courier Sprite",
    realAction: "postcard",
    truthClass: "attested",
    cooldownDays: 30,
    costsMoney: true,
  },
  golden_seal: {
    id: "golden_seal",
    fictionName: "Golden Seal",
    realAction: "offer",
    truthClass: "redeemable",
    cooldownDays: 30,
    costsMoney: true,
  },
};

export type RekindlingState = "dark" | "spark" | "ember" | "flame";

/** The highest impact class reached for one customer since the outreach began. */
export function rekindlingStateFor(reached: ImpactClass | null): RekindlingState {
  switch (reached) {
    case null:
    case "observation":
      return "dark";
    case "field_activity":
      return "spark";
    case "response":
    case "opportunity":
      return "ember";
    case "customer_outcome":
    case "economic_outcome":
      return "flame";
  }
}

export type CooldownVerdict =
  | { allowed: true }
  | { allowed: false; daysRemaining: number; reason: "cooldown" };

function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 86_400_000);
}

export function cooldownVerdict(input: {
  tool: ArsenalToolId;
  lastUsedBusinessDate: string | null;
  todayBusinessDate: string;
}): CooldownVerdict {
  if (!input.lastUsedBusinessDate) return { allowed: true };
  const elapsed = dayNumber(input.todayBusinessDate) - dayNumber(input.lastUsedBusinessDate);
  const remaining = ARSENAL_TOOLS[input.tool].cooldownDays - elapsed;
  return remaining > 0
    ? { allowed: false, daysRemaining: remaining, reason: "cooldown" }
    : { allowed: true };
}

/** Real cost shown before the Golden Seal is spent. Never hidden in fiction. */
export function goldenSealCost(input: {
  discountPercent: number;
  typicalOrderCents: number | null;
}): { label: string; estimatedCents: number | null } {
  if (input.typicalOrderCents == null)
    return { label: `${input.discountPercent}% off their next order`, estimatedCents: null };
  const cents = Math.round((input.typicalOrderCents * input.discountPercent) / 100);
  return {
    label: `${input.discountPercent}% off their next order, about $${(cents / 100).toFixed(2)} of real margin`,
    estimatedCents: cents,
  };
}

/** House voice after a send. States the fact; makes no promise. */
export function sentLine(tool: ArsenalToolId): string {
  return `${ARSENAL_TOOLS[tool].fictionName} sent. Now the light decides.`;
}
