import twilio from "twilio";

export function isValidTwilioWebhook(input: {
  authToken: string;
  signature: unknown;
  urls: string[];
  body: Record<string, string>;
  nodeEnv: string;
}): boolean {
  if (!input.authToken) return input.nodeEnv !== "production";
  if (typeof input.signature !== "string" || !input.signature) return false;
  return input.urls.some(url =>
    twilio.validateRequest(input.authToken, input.signature as string, url, input.body)
  );
}
