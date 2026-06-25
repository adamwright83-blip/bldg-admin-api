import { AgentMailClient } from "agentmail";

/**
 * Slice 74e. Verified against the installed `agentmail` package
 * (v0.5.12, not @agentmail/sdk): AgentMailClient is constructed with
 * { apiKey }, and client.inboxes.messages.send(inboxId, { to, subject,
 * text, html, labels, ... }) resolves directly to { messageId, threadId }
 * (HttpResponsePromise extends Promise). SendMessageRequest has no
 * clientId/client_id field, so HELD's own durable idempotency key remains
 * the only duplicate-send protection -- no AgentMail-side idempotency is
 * invented here. No SMTP, IMAP, or nodemailer path exists anywhere in
 * this file. The API key is read from env and handed to the SDK's auth
 * provider only; it is never logged, returned, or included in any result.
 */

export type AgentMailEnv = Record<string, string | undefined>;

export const AGENTMAIL_REQUIRED_ENV_VARS = [
  "AGENTMAIL_API_KEY",
  "AGENTMAIL_VENDOR_INBOX_ID",
  "AGENTMAIL_VENDOR_INBOX_EMAIL",
] as const;

export const SUPERVISED_CANARY_CONFIRMATION_TEXT = "SEND SUPERVISED EMAIL CANARY";

function readMissingEnvVars(env: AgentMailEnv, names: readonly string[]): string[] {
  return names.filter(name => !env[name] || !env[name]!.trim());
}

function parseAllowlist(value: string | undefined): string[] {
  return (value ?? "").split(",").map(item => item.trim()).filter(Boolean);
}

export type AgentMailProviderReadiness = {
  providerName: "agentmail";
  providerSelected: boolean;
  configured: boolean;
  missingEnvVars: string[];
  requiredEnvVars: string[];
  canaryEnabled: boolean;
  inboxIdPresent: boolean;
  inboxEmailPresent: boolean;
  sourceAllowlist: string[];
  categoryAllowlist: string[];
  liveSendAllowed: false;
  webhooksDeferredTo: "74f";
  blockedReasons: string[];
  nextAction: string;
};

/** Configuration inspection only. Never logs or returns the API key value. */
export function inspectAgentMailReadiness(env: AgentMailEnv = process.env): AgentMailProviderReadiness {
  const providerSelected = env.HELD_VENDOR_EMAIL_PROVIDER === "agentmail";
  const missingEnvVars = readMissingEnvVars(env, AGENTMAIL_REQUIRED_ENV_VARS);
  const configured = missingEnvVars.length === 0;
  const canaryEnabled = env.HELD_VENDOR_EMAIL_CANARY_ENABLED === "true";
  const sourceAllowlist = parseAllowlist(env.HELD_VENDOR_EMAIL_SOURCE_ALLOWLIST);
  const categoryAllowlist = parseAllowlist(env.HELD_VENDOR_EMAIL_CATEGORY_ALLOWLIST);

  const blockedReasons: string[] = [];
  if (!providerSelected) blockedReasons.push("agentmail_not_selected_provider");
  if (!configured) blockedReasons.push("agentmail_env_missing");
  if (!canaryEnabled) blockedReasons.push("live_email_canary_disabled");

  return {
    providerName: "agentmail",
    providerSelected,
    configured,
    missingEnvVars,
    requiredEnvVars: [...AGENTMAIL_REQUIRED_ENV_VARS],
    canaryEnabled,
    inboxIdPresent: Boolean(env.AGENTMAIL_VENDOR_INBOX_ID?.trim()),
    inboxEmailPresent: Boolean(env.AGENTMAIL_VENDOR_INBOX_EMAIL?.trim()),
    sourceAllowlist,
    categoryAllowlist,
    liveSendAllowed: false,
    webhooksDeferredTo: "74f",
    blockedReasons,
    nextAction: !configured
      ? `Set required env vars: ${missingEnvVars.join(", ")}`
      : !canaryEnabled
        ? "Set HELD_VENDOR_EMAIL_CANARY_ENABLED=true to enable the supervised canary action."
        : "Configuration and canary flag are ready; an admin must still explicitly confirm each send.",
  };
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AgentMailLiveSendGateInput = {
  sourceKey: string;
  category: string | null;
  recipientEmail: string | null;
  durableDraftId: string | null;
  durableAttemptId: string | null;
  idempotencyKey: string | null;
  sendGatePassed: boolean;
  founderEscalationPresent: boolean;
  forbiddenClaimsDetected: string[];
  adminConfirmationText: string;
  env?: AgentMailEnv;
};

export type AgentMailLiveSendGateDecision = { allowed: boolean; reasons: string[] };

/**
 * Evaluates every supervised-canary precondition. Allowed only when the
 * provider is selected and fully configured, the canary flag is on, both
 * the sourceKey and category are allowlisted, a durable draft and an
 * attempt identity exist, the send gate already passed, founder escalation
 * is present, no forbidden claims were detected, the recipient is a
 * plausible email address, and the admin typed the exact confirmation
 * phrase. No network call happens in this function.
 */
export function evaluateAgentMailLiveSendGate(input: AgentMailLiveSendGateInput): AgentMailLiveSendGateDecision {
  const env = input.env ?? process.env;
  const readiness = inspectAgentMailReadiness(env);
  const reasons: string[] = [...readiness.blockedReasons];

  if (!readiness.sourceAllowlist.includes(input.sourceKey)) reasons.push("source_not_allowlisted");
  if (!input.category || !readiness.categoryAllowlist.includes(input.category)) reasons.push("category_not_allowlisted");
  if (!input.durableDraftId) reasons.push("durable_draft_id_required");
  if (!input.durableAttemptId && !input.idempotencyKey) reasons.push("durable_attempt_identity_required");
  if (!input.sendGatePassed) reasons.push("send_gate_not_passed");
  if (!input.founderEscalationPresent) reasons.push("founder_escalation_missing");
  if (input.forbiddenClaimsDetected.length > 0) reasons.push("forbidden_claims_detected");
  if (!input.recipientEmail || !EMAIL_PATTERN.test(input.recipientEmail)) reasons.push("recipient_email_invalid");
  if (input.adminConfirmationText !== SUPERVISED_CANARY_CONFIRMATION_TEXT) reasons.push("admin_confirmation_text_mismatch");

  return { allowed: reasons.length === 0, reasons: Array.from(new Set(reasons)) };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Converts the already-approved plain-text draft into simple safe HTML:
 * paragraphs and line breaks only. Never adds links, images, marketing
 * copy, or tracking of any kind -- it only escapes and re-wraps the exact
 * text it is given.
 */
export function renderSafeHtmlFromTextDraft(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(block => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

export function buildAgentMailLabels(input: { sourceKey: string; category: string }): string[] {
  const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return [
    "held_vendor_outreach",
    sanitize(input.sourceKey),
    sanitize(input.category),
    "response_pending",
    "slice_74e",
  ];
}

export type AgentMailSendInput = {
  inboxId: string;
  inboxEmail: string;
  recipientEmail: string;
  subject: string;
  textBody: string;
  labels?: string[];
};

export type AgentMailSendResult = {
  providerName: "agentmail";
  providerAttemptId: string | null;
  threadId: string | null;
  inboxId: string;
  inboxEmail: string;
  status: "sent" | "rejected";
  liveProviderInvoked: boolean;
  rawProviderResponseJson: Record<string, unknown> | null;
  sentAt: string | null;
  errorReason: string | null;
};

export type MinimalAgentMailClient = {
  inboxes: {
    messages: {
      send: (
        inboxId: string,
        request: { to?: string; subject?: string; text?: string; html?: string; labels?: string[] },
      ) => Promise<{ messageId?: string; threadId?: string }>;
    };
  };
};

let lazyClient: AgentMailClient | null = null;

function resolveAgentMailClient(env: AgentMailEnv): MinimalAgentMailClient {
  if (!lazyClient) {
    lazyClient = new AgentMailClient({ apiKey: env.AGENTMAIL_API_KEY });
  }
  return lazyClient as unknown as MinimalAgentMailClient;
}

/**
 * Sends exactly one supervised vendor email through the existing AgentMail
 * inbox. Callers must run evaluateAgentMailLiveSendGate() first and only
 * call this when it returned allowed: true -- this function does not
 * re-check the gate itself, by design, so it can be tested independently
 * with a mocked client and never makes a real network call in tests.
 */
export async function sendVendorEmailViaAgentMail(
  input: AgentMailSendInput,
  options?: { client?: MinimalAgentMailClient; env?: AgentMailEnv },
): Promise<AgentMailSendResult> {
  const client = options?.client ?? resolveAgentMailClient(options?.env ?? process.env);
  const htmlBody = renderSafeHtmlFromTextDraft(input.textBody);

  try {
    const response = await client.inboxes.messages.send(input.inboxId, {
      to: input.recipientEmail,
      subject: input.subject,
      text: input.textBody,
      html: htmlBody,
      ...(input.labels && input.labels.length > 0 ? { labels: input.labels } : {}),
    });
    return {
      providerName: "agentmail",
      providerAttemptId: response.messageId ?? null,
      threadId: response.threadId ?? null,
      inboxId: input.inboxId,
      inboxEmail: input.inboxEmail,
      status: "sent",
      liveProviderInvoked: true,
      rawProviderResponseJson: { messageId: response.messageId ?? null, threadId: response.threadId ?? null },
      sentAt: new Date().toISOString(),
      errorReason: null,
    };
  } catch (error) {
    return {
      providerName: "agentmail",
      providerAttemptId: null,
      threadId: null,
      inboxId: input.inboxId,
      inboxEmail: input.inboxEmail,
      status: "rejected",
      liveProviderInvoked: true,
      rawProviderResponseJson: null,
      sentAt: null,
      errorReason: error instanceof Error ? error.message : "unknown_error",
    };
  }
}
