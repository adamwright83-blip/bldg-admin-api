/** Saleslay Battle Canvas — ability catalog. Each ability is a dragon-fire
 * attack tied to a real business action label; damage/reward/cooldown are
 * fixed per the demo spec (not tunable from outside this file).
 *
 * `flavorName` is the sales-move label shown on the button (marketing frames
 * these as real business actions in disguise); `logText`/`id` stay tied to
 * the real event so the battle log and future backend wiring stay honest. */

export type AbilityId = "email" | "call" | "pickup" | "collect";

export type AbilityDef = {
  id: AbilityId;
  key: "1" | "2" | "3" | "4";
  /** Sales-move fantasy label shown on the button. */
  flavorName: string;
  /** Real business action this represents (unused in UI, kept for clarity). */
  label: string;
  damage: number;
  xp: number;
  contractCents: number;
  cooldownMs: number;
  logText: string;
};

export const ABILITY_CONFIG: AbilityDef[] = [
  {
    id: "call",
    key: "1",
    flavorName: "Bold Pitch",
    label: "Make Sales Call",
    damage: 20,
    xp: 65,
    contractCents: 15_000,
    cooldownMs: 8_000,
    logText: "Sales call logged: +65 XP, +$150 contract progress.",
  },
  {
    id: "pickup",
    key: "2",
    flavorName: "Fulfill the Promise",
    label: "Complete Pickup",
    damage: 15,
    xp: 50,
    contractCents: 10_000,
    cooldownMs: 6_000,
    logText: "Pickup completed: +50 XP, +$100 contract progress.",
  },
  {
    id: "email",
    key: "3",
    flavorName: "Follow Up",
    label: "Send Email",
    damage: 12,
    xp: 30,
    contractCents: 7_500,
    cooldownMs: 5_000,
    logText: "Email sent: +30 XP, +$75 contract progress.",
  },
  {
    id: "collect",
    key: "4",
    flavorName: "Close the Deal",
    label: "Collect Payment",
    damage: 30,
    xp: 100,
    contractCents: 30_000,
    cooldownMs: 12_000,
    logText: "Payment collected: +100 XP, +$300 contract progress.",
  },
];

export const FIRE_COOLDOWN_ID = "fire";
export const FIRE_COOLDOWN_MS = 1_200;
export const FIRE_DAMAGE = 10;
export const FIRE_FLAVOR_NAME = "Fire Breath";

export const VILLAIN_ATTACK_INTERVAL_MS = 5_000;
export const VILLAIN_ATTACK_DAMAGE = 8;

export const DAILY_CONTRACT_COMPLETE_BONUS_XP = 500;

/** Windup/telegraph timings (Section 4 — playability feedback). */
export const DRAGON_WINDUP_MS = 120;
export const VILLAIN_TELEGRAPH_MS = 350;
