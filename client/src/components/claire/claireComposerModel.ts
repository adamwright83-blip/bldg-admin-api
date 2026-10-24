/**
 * Pure state for the shared Claire composer (Admin Claire Desk + Driver).
 *
 * The server keeps Claire's conversation state for 12 hours per conversationId
 * (DESK_CONVERSATION_TTL_MS in server/claire/claireRouter.ts). The visible log is
 * kept on this device for the same window so a reload shows what was said; after
 * that both sides start fresh together. Nothing here is business truth.
 */

export type ClaireComposerLine = {
  who: "you" | "claire";
  text: string;
  at: number;
  /** The request for this message failed; Claire may or may not have received it. */
  unanswered?: boolean;
};

export type ClaireComposerConversation = {
  conversationId: string;
  startedAt: number;
  lines: ClaireComposerLine[];
};

/** Mirrors the server's desk conversation TTL. */
export const CLAIRE_COMPOSER_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_STORED_LINES = 200;

export function claireComposerStorageKey(openId: string): string {
  return `joystick.claire.composer.v1:${openId}`;
}

export function newClaireConversationId(): string {
  // The server accepts 8–64 characters.
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `composer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function freshConversation(now: number): ClaireComposerConversation {
  return { conversationId: newClaireConversationId(), startedAt: now, lines: [] };
}

/** Restores a stored conversation only if it is well formed and the server still holds its state. */
export function parseStoredConversation(raw: string | null, now: number): ClaireComposerConversation | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ClaireComposerConversation>;
    if (
      typeof value.conversationId !== "string" ||
      value.conversationId.length < 8 ||
      value.conversationId.length > 64 ||
      typeof value.startedAt !== "number" ||
      !Array.isArray(value.lines)
    ) {
      return null;
    }
    if (now - value.startedAt >= CLAIRE_COMPOSER_TTL_MS) return null;
    const lines = value.lines
      .filter(
        (l): l is ClaireComposerLine =>
          Boolean(l) &&
          (l.who === "you" || l.who === "claire") &&
          typeof l.text === "string" &&
          typeof l.at === "number"
      )
      .map(l => (l.unanswered === true ? { who: l.who, text: l.text, at: l.at, unanswered: true } : { who: l.who, text: l.text, at: l.at }));
    return { conversationId: value.conversationId, startedAt: value.startedAt, lines };
  } catch {
    return null;
  }
}

/** Marks the operator line sent at `at` as unanswered, so the log still says so after a reload. */
export function markUnanswered(conversation: ClaireComposerConversation, at: number): ClaireComposerConversation {
  return {
    ...conversation,
    lines: conversation.lines.map(l => (l.who === "you" && l.at === at ? { ...l, unanswered: true } : l)),
  };
}

export function serializeConversation(conversation: ClaireComposerConversation): string {
  return JSON.stringify({ ...conversation, lines: conversation.lines.slice(-MAX_STORED_LINES) });
}

/**
 * What the operator sees when a turn fails. A failed request may still have
 * reached Claire and saved work, so the copy never claims nothing changed.
 */
export function claireComposerErrorCopy(error: { code?: string | null; message?: string | null }): string {
  if (error.code === "UNAUTHORIZED") return "You're signed out. Sign in again to talk to Claire.";
  if (error.code === "FORBIDDEN") {
    return "Claire's text line needs your JOYSTICK account sign-in. The shared driver password can't reach her.";
  }
  const detail = error.message?.trim() ? ` (${error.message.trim()})` : "";
  return `Claire's reply didn't arrive${detail}. If you asked her to change something, check before sending it again — it may already be saved.`;
}
