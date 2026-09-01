/**
 * The one switch that turns on deterministic stand-ins for external providers.
 *
 * Goldline's world is driven by real providers — an LLM for Field Journal
 * extraction, an image model for tower art. Neither can be called from a
 * disposable proof database, so the browser proof of journal → discovery →
 * forge would otherwise be unprovable without production credentials.
 *
 * This module exists so that substitution is explicit, single-sourced and
 * impossible to reach in production:
 *
 *  - it is refused outright when NODE_ENV is "production", regardless of how
 *    the environment variable is set, so a stray deploy variable cannot make
 *    fixture data look like provider truth;
 *  - it must be asked for by name (GOLDLINE_PROOF_MODE=1), so it never turns
 *    itself on in an ordinary dev session;
 *  - everything it enables is labelled as test-only in the data it writes.
 *
 * Production behaviour is unchanged: a real provider, or the truthful
 * unconfigured state. Proof mode never becomes a third silent answer.
 */

export function goldlineProofModeEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.GOLDLINE_PROOF_MODE === "1";
}

/**
 * Guard for code paths that must never execute against real data. Call this at
 * the moment of substitution rather than trusting an earlier check.
 */
export function assertProofModeAllowed(what: string) {
  if (process.env.NODE_ENV === "production")
    throw new Error(`${what} is a proof-only path and cannot run in production`);
  if (!goldlineProofModeEnabled())
    throw new Error(`${what} requires GOLDLINE_PROOF_MODE=1`);
}
