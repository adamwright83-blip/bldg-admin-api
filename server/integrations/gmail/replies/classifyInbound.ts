/**
 * What an inbound message in a tracked conversation is: a person writing back, an automatic answer (out of office,
 * an autoresponder), a delivery failure, a bulk/list message, or the mailbox owner's own message. Decided from the
 * headers RFC 3834 and mail servers set, never from guessing at the words, and conservative: when unsure it is not a
 * human reply, because a human reply is what Claire and the game may treat as someone answering.
 */
export type InboundKind = "human_reply" | "auto_reply" | "delivery_failure" | "bulk" | "own_message";

export type InboundHeaders = Record<string, string | undefined>;

const header = (headers: InboundHeaders, name: string) => {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === wanted) return (value ?? "").trim();
  return "";
};

/** The bare address from a From/To header value. */
export function addressOf(value: string): string {
  const angle = value.match(/<([^>]+)>/)?.[1];
  return (angle ?? value).trim().replace(/^mailto:/i, "").toLowerCase();
}

const AUTO_SUBJECT = /^(automatic reply|auto(?:matic)?[- ]?(?:reply|response)|out of (?:the )?office|ooo\b|away from (?:the )?office|autoreply|auto:)/i;
const BOUNCE_SUBJECT = /^(delivery status notification|undeliverable|undelivered mail|mail delivery (?:failed|failure|subsystem)|returned mail|failure notice|delivery failure)/i;
const BOUNCE_SENDER = /^(mailer-daemon|postmaster|mail-daemon|bounce[s]?)(\+[^@]*)?@/i;

export function classifyInbound(input: { headers: InboundHeaders; labelIds: readonly string[]; mailboxEmail: string }): InboundKind {
  const from = addressOf(header(input.headers, "From"));
  if (input.labelIds.includes("SENT") || (from && from === input.mailboxEmail.toLowerCase())) return "own_message";

  const contentType = header(input.headers, "Content-Type").toLowerCase();
  const subject = header(input.headers, "Subject");
  if (BOUNCE_SENDER.test(from) || /multipart\/report/.test(contentType) && /delivery-status/.test(contentType) || BOUNCE_SUBJECT.test(subject)) {
    return "delivery_failure";
  }

  const autoSubmitted = header(input.headers, "Auto-Submitted").toLowerCase();
  const precedence = header(input.headers, "Precedence").toLowerCase();
  if (
    (autoSubmitted && autoSubmitted !== "no") ||
    header(input.headers, "X-Autoreply") ||
    header(input.headers, "X-Autorespond") ||
    header(input.headers, "X-Auto-Reply") ||
    precedence === "auto_reply" ||
    AUTO_SUBJECT.test(subject)
  ) {
    return "auto_reply";
  }
  if (precedence === "bulk" || precedence === "junk" || precedence === "list" || header(input.headers, "List-Id") || header(input.headers, "List-Unsubscribe")) {
    return "bulk";
  }
  return "human_reply";
}

/** Message-IDs this message answers (In-Reply-To and References), normalised to <id>. */
export function referencedMessageIds(headers: InboundHeaders): string[] {
  const raw = `${header(headers, "In-Reply-To")} ${header(headers, "References")}`;
  return [...new Set((raw.match(/<[^<>\s]+>/g) ?? []).map(id => id.toLowerCase()))];
}
