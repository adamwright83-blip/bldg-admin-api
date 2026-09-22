import { createHash } from "node:crypto";
import twilio from "twilio";
import { readTwilioRestCredentials } from "./config";

/**
 * Canonical Twilio REST client for new platform code.
 * One SDK factory, created lazily. This module does not place calls,
 * send messages, or retry a dial.
 *
 * Production Claire Gather voice keeps its own client in
 * server/claire/claireTwilio.ts. Do not replace that path from here.
 */

export type TwilioPlatformClient = ReturnType<typeof twilio>;

export class TwilioPlatformConfigError extends Error {
  readonly code: "missing_account_sid" | "missing_auth_token";

  constructor(code: "missing_account_sid" | "missing_auth_token") {
    super(`Twilio platform client is not configured (${code})`);
    this.name = "TwilioPlatformConfigError";
    this.code = code;
  }
}

let cached: { key: string; client: TwilioPlatformClient } | null = null;

export function getTwilioPlatformClient(
  env: NodeJS.ProcessEnv = process.env
): TwilioPlatformClient {
  const credentials = readTwilioRestCredentials(env);
  if (!credentials) {
    throw new TwilioPlatformConfigError(
      env.TWILIO_ACCOUNT_SID?.trim() ? "missing_auth_token" : "missing_account_sid"
    );
  }
  const key = createHash("sha256")
    .update(`${credentials.accountSid}\n${credentials.authToken}`)
    .digest("hex");
  if (!cached || cached.key !== key) {
    cached = {
      key,
      client: twilio(credentials.accountSid, credentials.authToken),
    };
  }
  return cached.client;
}

export function resetTwilioPlatformClientForTests(): void {
  cached = null;
}
