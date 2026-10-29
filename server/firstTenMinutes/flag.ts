import { TRPCError } from "@trpc/server";
import { FIRST_TEN_FLAG, parseFirstTenMode, type FirstTenMode } from "../../shared/firstTenMinutes";

/**
 * JOYSTICK_FIRST_TEN_MINUTES: `on`, `preview` (only browsers that opened /joystick-start?crew=1), or off.
 * Off by default. Turning it off hides the experience and refuses every first-ten procedure; nothing it stored is
 * deleted, and today's /joystick-start funnel is unaffected either way.
 */
export function firstTenMode(env: NodeJS.ProcessEnv = process.env): FirstTenMode {
  return parseFirstTenMode(env[FIRST_TEN_FLAG]);
}

export const FIRST_TEN_CLOSED_MESSAGE = "This JOYSTICK onboarding isn't open.";

export function assertFirstTenOpen(env: NodeJS.ProcessEnv = process.env): void {
  if (firstTenMode(env) === "off") {
    throw new TRPCError({ code: "FORBIDDEN", message: FIRST_TEN_CLOSED_MESSAGE });
  }
}
