/**
 * The world an operator chose before signing up, carried from the homepage into
 * the onboarding draft. JOYSTICK_BRAND_CANON.md requires the chosen game to
 * persist; docs/goldline/FIRST_TEN_MINUTES.md slice A records the entry contract.
 *
 * Only the two worlds the public homepage offers are recognised. Anything else,
 * including the SPA landing's free-text `game` field, is not a world choice.
 */
export const JOYSTICK_EXPERIENCES = ["lantern_city", "trailblazer"] as const;
export type JoystickExperience = (typeof JOYSTICK_EXPERIENCES)[number];

export const JOYSTICK_EXPERIENCE_LABELS: Record<JoystickExperience, string> = {
  lantern_city: "Lantern City",
  trailblazer: "Trailblazer",
};

const ALIASES: Record<string, JoystickExperience> = {
  cozy: "lantern_city",
  lantern_city: "lantern_city",
  road: "trailblazer",
  trailblazer: "trailblazer",
};

export function parseJoystickExperience(raw: unknown): JoystickExperience | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ALIASES[key] ?? null;
}

/** Reads `world`, then `mode`, then `game` from an entry URL's query string. */
export function experienceFromEntrySearch(search: string): JoystickExperience | null {
  const params = new URLSearchParams(search);
  for (const name of ["world", "mode", "game"]) {
    const parsed = parseJoystickExperience(params.get(name));
    if (parsed) return parsed;
  }
  return null;
}
