/**
 * JOYSTICK_ONBOARDING_INTELLIGENCE: `on` runs the business investigation during a person's first-ten reading, asks
 * Claire's clarification questions before the portrait, writes the portrait from the reconciled understanding, and
 * gives Claire that understanding afterwards. Anything else (the default) is off: the onboarding behaves exactly
 * as before and nothing new is read, stored or shown. Turning it off later hides it; nothing stored is deleted.
 */
export const ONBOARDING_INTELLIGENCE_FLAG = "JOYSTICK_ONBOARDING_INTELLIGENCE";

export function onboardingIntelligenceOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ONBOARDING_INTELLIGENCE_FLAG]?.trim().toLowerCase() === "on";
}
