import { TRPCError } from "@trpc/server";
import { FIRST_TEN_FLAG, parseFirstTenMode, type FirstTenMode } from "../../shared/firstTenMinutes";
import { currentPreviewVersion, requestHasPreviewPass } from "./previewPass";
import { accountCookieFrom } from "../joystickAccount/session";

/**
 * JOYSTICK_FIRST_TEN_MINUTES: `on`, `preview` (only browsers holding the server-issued preview pass, from
 * /joystick-start?crew=<JOYSTICK_FIRST_TEN_PREVIEW_CODE>), or off.
 * Off by default. Turning it off hides the experience and refuses every first-ten procedure; nothing it stored is
 * deleted, and today's /joystick-start funnel is unaffected either way.
 */
export function firstTenMode(env: NodeJS.ProcessEnv = process.env): FirstTenMode {
  return parseFirstTenMode(env[FIRST_TEN_FLAG]);
}

export const FIRST_TEN_CLOSED_MESSAGE = "This JOYSTICK onboarding isn't open.";

/**
 * Whether this request may use the first ten minutes: `on`, or `preview` with a preview pass (previewPass.ts) or a
 * signed-in JOYSTICK account admitted under the current crew code (it carries the pass to any device the person
 * signs in on). The account's journeys still need its unrevoked journey token.
 */
export function firstTenOpenFor(req: { headers: { cookie?: string } } | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = firstTenMode(env);
  if (mode === "on") return true;
  if (mode === "preview") {
    if (requestHasPreviewPass(req?.headers.cookie, env)) return true;
    // an account admitted under the current crew code: a new code (or none) closes it, as it does every pass
    const account = accountCookieFrom(req?.headers.cookie, env);
    const current = currentPreviewVersion(env);
    return Boolean(account?.previewVersion && current && account.previewVersion === current);
  }
  return false;
}

/** Refuses unless the experience is open to this request; in `preview`, that takes the server-issued preview pass. */
export function assertFirstTenOpen(req: { headers: { cookie?: string } } | null, env: NodeJS.ProcessEnv = process.env): void {
  if (!firstTenOpenFor(req, env)) {
    throw new TRPCError({ code: "FORBIDDEN", message: FIRST_TEN_CLOSED_MESSAGE });
  }
}
