/** Saleslay Battle Canvas — weapon-capability contract.
 *
 * The ability buttons are not permanently decorative. Every weapon is a
 * launcher for a real business-growing action; the projectile/damage is
 * the visual reward layer around that real work. Today every weapon still
 * resolves through the DEMO execution path (SaleslayBattleEngine.useAbility
 * / fireBasic), which credits the reward once the fireball lands — no real
 * phone call, email, SMS, pickup, or payment happens yet. This file exists
 * so a future real-action adapter can plug into the same HUD without
 * another architectural rewrite: it calls completeWeaponAction() /
 * failWeaponAction() once the real milestone fires (call connected, email
 * sent, pickup completed, payment collected) instead of relying on a fixed
 * animation timer.
 *
 * No live phone/microphone/SMS/email/payment integration exists here —
 * this is the frontend contract those adapters will later implement. */

export type WeaponActionStatus =
  | "ready"
  | "arming"
  | "awaiting-permission"
  | "connecting"
  | "live"
  | "working"
  | "success"
  | "failed"
  | "cooldown"
  | "disabled";

export type WeaponCapability = {
  abilityId: string;
  status: WeaponActionStatus;
  statusLabel?: string;
  /** Today's behavior: runs the existing demo resolution (cooldown +
   * animated projectile, reward on landing). A future adapter replaces
   * this per-ability without touching the tray UI. */
  executeDemoAction: () => void;
};

/** Real capability each weapon is intended to eventually launch. Renaming
 * or remapping these requires a deliberate product decision — not a
 * side effect of an asset or engine change. */
export const WEAPON_REAL_CAPABILITY: Record<string, string> = {
  fire: "Future real quick-action capability (kept capability-addressable)",
  call: "Real outbound phone call",
  // NOT operational order pickup — Saleslay never mutates order status or
  // sends driver/pickup SMS (that's the separate driver-app product). The
  // "pickup" ability id is a historical leftover; its permanent future
  // meaning is completing a promised sales next step for a lead (quote,
  // pricing, proposal, samples, booking link, info, callback, custom
  // offer). No real behavior is implemented for it yet.
  pickup: "Real completion of a promised sales next step (not order pickup)",
  email: "Real email or SMS follow-up",
  collect: "Real payment request or collection workflow",
};

/**
 * Documented future states for Bold Pitch specifically (real outbound
 * calling). Not implemented, not wired to any UI yet — reserved so the
 * eventual call adapter has a known vocabulary to target and the compact
 * HUD structure doesn't need to be redesigned when it lands. The future
 * experience must keep the battlefield and Spark visible throughout: this
 * is a compact in-game call status, never a separate call-center page.
 */
export type FutureCallState =
  | "microphone-required"
  | "phone-not-connected"
  | "ready-to-call"
  | "dialing"
  | "ringing"
  | "connected"
  | "muted"
  | "call-ended"
  | "call-failed";
