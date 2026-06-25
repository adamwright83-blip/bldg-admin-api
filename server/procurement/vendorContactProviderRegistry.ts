/**
 * Slice 74d foundation only. No email/SMS/form SDK is imported here, and
 * none is needed: every path in this module is a pure inspection or a
 * hardcoded refusal. evaluateLiveSendGate() and the two "gated_provider_future"
 * adapter shells always end in a permanent, slice-scoped refusal
 * ("blocked_live_send_not_enabled_for_slice_74d") regardless of which env
 * vars or flags are set -- a later, dedicated canary slice must explicitly
 * remove that hardcoded reason before any real send becomes possible.
 */

export const PROVIDER_MODES = ["noop_provider", "gated_provider_future"] as const;
export type ProviderMode = (typeof PROVIDER_MODES)[number];

export type ProviderChannel = "noop" | "email" | "website_form";

export type ProviderEnv = Record<string, string | undefined>;

export const REQUIRED_EMAIL_ENV_VARS = [
  "VENDOR_OUTREACH_LIVE_FEATURE_FLAG",
  "VENDOR_OUTREACH_EMAIL_PROVIDER_ENABLED",
  "VENDOR_OUTREACH_EMAIL_CANARY_ENABLED",
  "VENDOR_OUTREACH_EMAIL_PROVIDER_API_KEY",
  "VENDOR_OUTREACH_EMAIL_FROM_ADDRESS",
] as const;

export const REQUIRED_WEBSITE_FORM_ENV_VARS = [] as const;

export type ProviderCapability = {
  providerName: string;
  channel: ProviderChannel;
  mode: ProviderMode;
  liveEnabled: false;
  configured: boolean;
  missingEnvVars: string[];
  requiredEnvVars: string[];
  canaryEnabled: boolean;
  sourceAllowlisted: boolean | null;
  canSend: false;
  blockedReasons: string[];
};

function readEnv(env: ProviderEnv, names: readonly string[]): { missing: string[]; values: Record<string, string | undefined> } {
  const missing: string[] = [];
  const values: Record<string, string | undefined> = {};
  for (const name of names) {
    const value = env[name];
    values[name] = value;
    if (!value || !value.trim()) missing.push(name);
  }
  return { missing, values };
}

export function inspectNoopProviderCapability(): ProviderCapability {
  return {
    providerName: "noop",
    channel: "noop",
    mode: "noop_provider",
    liveEnabled: false,
    configured: true,
    missingEnvVars: [],
    requiredEnvVars: [],
    canaryEnabled: false,
    sourceAllowlisted: null,
    canSend: false,
    blockedReasons: [],
  };
}

/**
 * Inspects configuration only -- never imports or calls any email SDK.
 * Even when every env var is present and the canary flag reads "true",
 * blockedReasons still always includes the permanent Slice 74d refusal.
 */
export function inspectEmailProviderCapability(env: ProviderEnv = process.env): ProviderCapability {
  const { missing, values } = readEnv(env, REQUIRED_EMAIL_ENV_VARS);
  const configured = missing.length === 0;
  const canaryEnabled = values.VENDOR_OUTREACH_EMAIL_CANARY_ENABLED === "true";
  const blockedReasons: string[] = [];
  if (!configured) blockedReasons.push("email_provider_env_missing");
  if (configured && !canaryEnabled) blockedReasons.push("live_email_canary_disabled");
  blockedReasons.push("blocked_live_send_not_enabled_for_slice_74d");
  return {
    providerName: "email_provider_future",
    channel: "email",
    mode: "gated_provider_future",
    liveEnabled: false,
    configured,
    missingEnvVars: missing,
    requiredEnvVars: [...REQUIRED_EMAIL_ENV_VARS],
    canaryEnabled,
    sourceAllowlisted: null,
    canSend: false,
    blockedReasons: Array.from(new Set(blockedReasons)),
  };
}

/**
 * No real browser automation or form submission exists anywhere in this
 * module or anywhere it calls. This capability is permanently unconfigured
 * until a future slice actually implements one.
 */
export function inspectWebsiteFormProviderCapability(): ProviderCapability {
  return {
    providerName: "website_form_future",
    channel: "website_form",
    mode: "gated_provider_future",
    liveEnabled: false,
    configured: false,
    missingEnvVars: [],
    requiredEnvVars: [...REQUIRED_WEBSITE_FORM_ENV_VARS],
    canaryEnabled: false,
    sourceAllowlisted: null,
    canSend: false,
    blockedReasons: ["website_form_automation_not_implemented", "blocked_live_send_not_enabled_for_slice_74d"],
  };
}

export type ProviderReadiness = {
  noop: ProviderCapability;
  email: ProviderCapability;
  websiteForm: ProviderCapability;
  liveSendingEnabled: false;
  nextRequiredActionForCanary: string;
};

export function buildProviderReadiness(env: ProviderEnv = process.env): ProviderReadiness {
  const email = inspectEmailProviderCapability(env);
  const websiteForm = inspectWebsiteFormProviderCapability();
  return {
    noop: inspectNoopProviderCapability(),
    email,
    websiteForm,
    liveSendingEnabled: false,
    nextRequiredActionForCanary: !email.configured
      ? `Set required env vars: ${email.missingEnvVars.join(", ")}`
      : !email.canaryEnabled
        ? "Enable VENDOR_OUTREACH_EMAIL_CANARY_ENABLED and define an explicit, separate canary slice before any live send can occur."
        : "All email config/flags are present, but live send remains permanently disabled in Slice 74d; a dedicated canary slice must explicitly remove that block.",
  };
}

export type LiveSendGateInput = {
  sourceKey: string;
  category?: string | null;
  sourceAllowlist?: readonly string[];
  recipient: string | null;
  durableDraftId: string | null;
  durableAttemptId: string | null;
  idempotencyKey: string | null;
  sendGatePassed: boolean;
  founderEscalationPresent: boolean;
  forbiddenClaimsDetected: string[];
  env?: ProviderEnv;
};

export type LiveSendGateDecision = {
  allowed: false;
  dryRunOnly: true;
  noSendPerformed: true;
  liveSendAllowed: false;
  reasons: string[];
};

/**
 * Evaluates every required live-send precondition for visibility/audit
 * purposes, then always refuses: reasons always ends with the permanent
 * Slice 74d block regardless of how many earlier checks passed. No SDK
 * call, network request, or side effect of any kind happens here.
 */
export function evaluateLiveSendGate(input: LiveSendGateInput): LiveSendGateDecision {
  const reasons: string[] = [];
  const env = input.env ?? process.env;
  if (env.VENDOR_OUTREACH_LIVE_FEATURE_FLAG !== "true") reasons.push("global_live_outreach_flag_off");
  if (env.VENDOR_OUTREACH_EMAIL_PROVIDER_ENABLED !== "true") reasons.push("provider_feature_flag_off");
  if (env.VENDOR_OUTREACH_EMAIL_CANARY_ENABLED !== "true") reasons.push("live_email_canary_disabled");
  const allowlist = input.sourceAllowlist ?? [];
  const sourceAllowed = allowlist.includes(input.sourceKey) || (input.category ? allowlist.includes(input.category) : false);
  if (!sourceAllowed) reasons.push("source_not_allowlisted");
  if (!input.recipient?.trim()) reasons.push("recipient_missing_or_invalid");
  if (!input.durableDraftId) reasons.push("durable_draft_id_required");
  if (!input.durableAttemptId && !input.idempotencyKey) reasons.push("durable_attempt_identity_required");
  if (!input.sendGatePassed) reasons.push("send_gate_not_passed");
  if (!input.founderEscalationPresent) reasons.push("founder_escalation_missing");
  if (input.forbiddenClaimsDetected.length > 0) reasons.push("forbidden_claims_detected");
  reasons.push("blocked_live_send_not_enabled_for_slice_74d");
  return {
    allowed: false,
    dryRunOnly: true,
    noSendPerformed: true,
    liveSendAllowed: false,
    reasons: Array.from(new Set(reasons)),
  };
}

export type SendContactAttemptInput = {
  attemptId: string;
  recipient: string;
  subject: string;
  body: string;
};

export type SendContactAttemptResult = {
  providerName: string;
  channel: ProviderChannel;
  attemptId: string;
  sent: false;
  liveProviderInvoked: false;
  blockedReasons: string[];
  status: "blocked";
};

/** Email adapter shell. Inspects configuration only; never imports or calls a real email SDK. */
export function sendContactAttemptViaEmailProvider(
  input: SendContactAttemptInput,
  env: ProviderEnv = process.env,
): SendContactAttemptResult {
  const capability = inspectEmailProviderCapability(env);
  return {
    providerName: capability.providerName,
    channel: "email",
    attemptId: input.attemptId,
    sent: false,
    liveProviderInvoked: false,
    blockedReasons: capability.blockedReasons,
    status: "blocked",
  };
}

/** Website-form adapter shell. No browser automation and no form submission anywhere in this module. */
export function sendContactAttemptViaWebsiteFormProvider(input: { attemptId: string }): SendContactAttemptResult {
  const capability = inspectWebsiteFormProviderCapability();
  return {
    providerName: capability.providerName,
    channel: "website_form",
    attemptId: input.attemptId,
    sent: false,
    liveProviderInvoked: false,
    blockedReasons: capability.blockedReasons,
    status: "blocked",
  };
}
