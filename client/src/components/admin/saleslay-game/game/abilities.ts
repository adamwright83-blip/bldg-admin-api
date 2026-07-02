/** Saleslay Battle Canvas — ability catalog. Each ability is a dragon-fire
 * attack tied to a real business action label; damage/reward/cooldown are
 * fixed per the demo spec (not tunable from outside this file). */

export type AbilityId = "email" | "call" | "pickup" | "collect";

export type AbilityDef = {
  id: AbilityId;
  key: "1" | "2" | "3" | "4";
  label: string;
  damage: number;
  xp: number;
  contractCents: number;
  cooldownMs: number;
  logText: string;
};

export const ABILITY_CONFIG: AbilityDef[] = [
  {
    id: "email",
    key: "1",
    label: "Send Email",
    damage: 12,
    xp: 30,
    contractCents: 7_500,
    cooldownMs: 5_000,
    logText: "Email sent: +30 XP, +$75 contract progress.",
  },
  {
    id: "call",
    key: "2",
    label: "Make Sales Call",
    damage: 20,
    xp: 65,
    contractCents: 15_000,
    cooldownMs: 8_000,
    logText: "Sales call logged: +65 XP, +$150 contract progress.",
  },
  {
    id: "pickup",
    key: "3",
    label: "Complete Pickup",
    damage: 15,
    xp: 50,
    contractCents: 10_000,
    cooldownMs: 6_000,
    logText: "Pickup completed: +50 XP, +$100 contract progress.",
  },
  {
    id: "collect",
    key: "4",
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

export const VILLAIN_ATTACK_INTERVAL_MS = 5_000;
export const VILLAIN_ATTACK_DAMAGE = 8;

export const DAILY_CONTRACT_COMPLETE_BONUS_XP = 500;
