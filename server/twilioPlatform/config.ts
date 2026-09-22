import {
  type TwilioPlatformConfig,
  redactEndpointForLog,
} from "@shared/twilioPlatform";

/**
 * One env seam for the Twilio platform. Reuses the production variable names.
 * The auth token is readable only by the REST client constructor.
 */

const SECRET_ENV_NAMES = ["TWILIO_AUTH_TOKEN", "TWILIO_API_KEY_SECRET", "TWILIO_API_SECRET"] as const;

function trimmed(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]?.trim() ?? "";
}

function flagTrue(env: NodeJS.ProcessEnv, name: string): boolean {
  return trimmed(env, name).toLowerCase() === "true";
}

function present(value: string): boolean {
  return value.length > 0;
}

export type TwilioRestCredentials = {
  accountSid: string;
  authToken: string;
};

/**
 * Server-only. Do not log, serialize, or return this from an API.
 * Null when either production credential is missing.
 */
export function readTwilioRestCredentials(
  env: NodeJS.ProcessEnv = process.env
): TwilioRestCredentials | null {
  const accountSid = trimmed(env, "TWILIO_ACCOUNT_SID");
  const authToken = trimmed(env, "TWILIO_AUTH_TOKEN");
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken };
}

export function readTwilioPlatformConfig(
  env: NodeJS.ProcessEnv = process.env
): TwilioPlatformConfig {
  const claireFromNumber = trimmed(env, "CLAIRE_TWILIO_FROM_NUMBER");
  const smsFromNumber = trimmed(env, "TWILIO_FROM_NUMBER") || trimmed(env, "TWILIO_PHONE_NUMBER");
  const whatsappFrom = trimmed(env, "TWILIO_WHATSAPP_FROM");
  return {
    accountSidPresent: present(trimmed(env, "TWILIO_ACCOUNT_SID")),
    authTokenPresent: present(trimmed(env, "TWILIO_AUTH_TOKEN")),
    claireFromNumber: claireFromNumber || null,
    smsFromNumber: smsFromNumber || null,
    operatorPhoneConfigured:
      present(trimmed(env, "CLAIRE_OPERATOR_PHONE")) ||
      present(trimmed(env, "CLAIRE_OPERATOR_PHONES")),
    conversationRelayEnabled: flagTrue(env, "CLAIRE_TWILIO_CONVERSATION_RELAY"),
    answeringMachineDetectionEnabled: flagTrue(env, "CLAIRE_TWILIO_AMD"),
    proxyServiceSidPresent: present(trimmed(env, "TWILIO_PROXY_SERVICE_SID")),
    verifyServiceSidPresent: present(trimmed(env, "TWILIO_VERIFY_SERVICE_SID")),
    conversationsServiceSidPresent: present(trimmed(env, "TWILIO_CONVERSATIONS_SERVICE_SID")),
    messagingServiceSidPresent: present(trimmed(env, "TWILIO_MESSAGING_SERVICE_SID")),
    syncServiceSidPresent: present(trimmed(env, "TWILIO_SYNC_SERVICE_SID")),
    taskRouterWorkspaceSidPresent: present(trimmed(env, "TWILIO_TASKROUTER_WORKSPACE_SID")),
    studioFlowSidPresent: present(trimmed(env, "TWILIO_STUDIO_FLOW_SID")),
    studioFallbackEnabled: flagTrue(env, "CLAIRE_TWILIO_STUDIO_FALLBACK"),
    intelligenceServiceSidPresent: present(trimmed(env, "TWILIO_INTELLIGENCE_SERVICE_SID")),
    lookupEnabled: flagTrue(env, "TWILIO_LOOKUP_ENABLED"),
    transcriptionEnabled: flagTrue(env, "TWILIO_TRANSCRIPTION_ENABLED"),
    whatsappFrom: whatsappFrom || null,
    conferenceEnabled: flagTrue(env, "CLAIRE_TWILIO_CONFERENCE"),
    brandedCallingCustomerProfileSidPresent: present(
      trimmed(env, "TWILIO_BRANDED_CALLING_CUSTOMER_PROFILE_SID")
    ),
  };
}

export function twilioPlatformLogSnapshot(env: NodeJS.ProcessEnv = process.env): {
  accountSidPresent: boolean;
  authTokenPresent: boolean;
  claireFromNumber: string;
  smsFromNumber: string;
  operatorPhoneConfigured: boolean;
} {
  const config = readTwilioPlatformConfig(env);
  return {
    accountSidPresent: config.accountSidPresent,
    authTokenPresent: config.authTokenPresent,
    claireFromNumber: redactEndpointForLog(config.claireFromNumber),
    smsFromNumber: redactEndpointForLog(config.smsFromNumber),
    operatorPhoneConfigured: config.operatorPhoneConfigured,
  };
}

export function logContainsTwilioSecret(text: string, env: NodeJS.ProcessEnv = process.env): boolean {
  for (const name of SECRET_ENV_NAMES) {
    const secret = trimmed(env, name);
    if (secret.length >= 8 && text.includes(secret)) return true;
  }
  return false;
}
