/**
 * Operator-facing CleanCloud connection warnings.
 *
 * laundry_farm is Laundry Farm. default is Laundry Butler. A warning names one
 * business. A missing mailbox or a failed sync is a gap, not zero revenue.
 */

const FAILED_OUTCOMES = new Set([
  "extension_failed",
  "extension_parse",
  "extension_import",
  "rejected",
  "conflict",
  "unpaired",
  "failed",
  "unavailable",
  "direct_auth_failed",
]);

export function businessLabelForTenant(
  tenantId: string | null | undefined
): string {
  if (tenantId === "laundry_farm") return "Laundry Farm";
  if (tenantId === "default") return "Laundry Butler";
  return "this business";
}

/** A recorded sync outcome that must stay a failure. Heartbeats and successes are not failures. */
export function isFailedSyncOutcome(
  outcome: string | null | undefined
): boolean {
  const value = String(outcome ?? "")
    .trim()
    .toLowerCase();
  if (
    !value ||
    value === "imported" ||
    value === "replayed" ||
    value === "extension_export"
  )
    return false;
  return (
    FAILED_OUTCOMES.has(value) ||
    value.includes("fail") ||
    value.includes("reject")
  );
}

/** Keep operator copy free of tokens, mailbox addresses, and URLs. */
export function safeAttemptDetail(
  message: string | null | undefined
): string | null {
  const text = String(message ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text.length > 180) return null;
  if (/token|secret|password|bearer|database_url|@|https?:/i.test(text))
    return null;
  if (!/^[\w .,'’:-]+$/.test(text)) return null;
  return text;
}

export type OperatorConnectionWarningInput = {
  tenantId: string | null | undefined;
  /** False while the Gmail status query has not returned. */
  gmailStatusKnown: boolean;
  gmailConfigured: boolean;
  gmailConnected: boolean;
  lastAttemptOutcome?: string | null;
  lastAttemptMessage?: string | null;
};

/**
 * One alert for the selected business. Null when Gmail is connected and the
 * latest attempt is not a failure.
 */
export function operatorConnectionWarning(
  input: OperatorConnectionWarningInput
): string | null {
  const business = businessLabelForTenant(input.tenantId);
  const failed = isFailedSyncOutcome(input.lastAttemptOutcome);
  const detail = safeAttemptDetail(input.lastAttemptMessage);
  const gmailMissing =
    input.gmailStatusKnown && input.gmailConfigured && !input.gmailConnected;
  // Only a recorded missing-mailbox message names Gmail; a rejected password,
  // authenticator 2FA, or a verification timeout is a sign-in failure.
  const gmailFailure =
    failed &&
    String(input.lastAttemptMessage ?? "")
      .toLowerCase()
      .includes("gmail is not connected");
  if (!gmailMissing && !failed) return null;
  if (gmailMissing || gmailFailure) {
    const stayed = failed
      ? ` The last CleanCloud sync for ${business} failed and stays a failure.`
      : "";
    return `Jawbreaker Gmail is not connected for ${business}.${stayed} CleanCloud verification cannot finish for that business. That gap is not a zero.`;
  }
  const because = detail ? ` ${detail}` : "";
  return `The last CleanCloud sync for ${business} failed.${because} A failed sync stays a failure. That is not a zero.`;
}
