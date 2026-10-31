import { google, type gmail_v1 } from "googleapis";
import { MailboxAccessError, type FetchedMessage, type MailboxApi } from "./replyDetection";

type Auth = NonNullable<gmail_v1.Options["auth"]>;

/** HTTP status and OAuth error of a googleapis (gaxios) failure. */
function failureOf(error: unknown): { status: number | null; oauth: string | null } {
  const e = error as { response?: { status?: number; data?: { error?: unknown } }; status?: number; code?: unknown };
  const status = e.response?.status ?? (typeof e.status === "number" ? e.status : typeof e.code === "number" ? e.code : null);
  const data = e.response?.data?.error;
  return { status, oauth: typeof data === "string" ? data : null };
}

/** Revoked or expired grants (Testing-mode refresh tokens end after 7 days) mean reconnect, not retry. */
function accessDenied(error: unknown): MailboxAccessError | null {
  const { status, oauth } = failureOf(error);
  if (oauth === "invalid_grant" || oauth === "unauthorized_client" || status === 401) {
    return new MailboxAccessError(oauth === "invalid_grant" ? "Google ended JOYSTICK's access to this mailbox (invalid_grant); reconnect Gmail" : "Google refused this mailbox's access; reconnect Gmail");
  }
  return null;
}

async function call<T, F = never>(work: () => Promise<T>, on404?: () => F): Promise<T | F> {
  try {
    return await work();
  } catch (error) {
    const denied = accessDenied(error);
    if (denied) throw denied;
    if (on404 && failureOf(error).status === 404) return on404();
    throw error;
  }
}

const HEADERS = ["From", "To", "Subject", "In-Reply-To", "References", "Auto-Submitted", "Precedence", "X-Autoreply", "X-Autorespond", "X-Auto-Reply", "List-Id", "List-Unsubscribe", "Content-Type"];

/** The Gmail API calls reply detection makes, for one mailbox. Reads only: metadata and snippets, never bodies. */
export function gmailMailboxApi(auth: Auth): MailboxApi & {
  watch(topicName: string): Promise<{ historyId: string; expiration: Date }>;
  stop(): Promise<void>;
} {
  const gmail = google.gmail({ version: "v1", auth });
  return {
    historySince: (startHistoryId, pageToken) =>
      call(
        async () => {
          const { data } = await gmail.users.history.list({ userId: "me", startHistoryId, historyTypes: ["messageAdded"], pageToken, maxResults: 500 });
          const added = (data.history ?? []).flatMap(entry =>
            (entry.messagesAdded ?? []).flatMap(item => (item.message?.id && item.message.threadId ? [{ id: item.message.id, threadId: item.message.threadId }] : []))
          );
          const lastRecordId = data.history?.at(-1)?.id;
          return {
            added,
            historyId: String(data.historyId ?? startHistoryId),
            ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}),
            ...(lastRecordId ? { lastRecordId: String(lastRecordId) } : {}),
          };
        },
        () => "expired" as const
      ),
    message: id =>
      call(
        async (): Promise<FetchedMessage> => {
          const { data } = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: HEADERS });
          return {
            id: data.id ?? id,
            threadId: data.threadId ?? "",
            internalDate: new Date(Number(data.internalDate ?? 0)),
            labelIds: data.labelIds ?? [],
            headers: Object.fromEntries((data.payload?.headers ?? []).flatMap(h => (h.name ? [[h.name, h.value ?? ""]] : []))),
            snippet: data.snippet ?? "",
          };
        },
        () => "gone" as const
      ),
    threadMessageIds: threadId =>
      call(
        async () => {
          const { data } = await gmail.users.threads.get({ userId: "me", id: threadId, format: "minimal" });
          return (data.messages ?? []).flatMap(m => (m.id ? [m.id] : []));
        },
        () => "gone" as const
      ),
    currentHistoryId: () => call(async () => String((await gmail.users.getProfile({ userId: "me" })).data.historyId ?? "")),
    // the inbox only: new mail arriving, not every label change or the owner's own sends
    watch: topicName =>
      call(async () => {
        const { data } = await gmail.users.watch({ userId: "me", requestBody: { topicName, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" } });
        return { historyId: String(data.historyId ?? ""), expiration: new Date(Number(data.expiration ?? 0)) };
      }),
    stop: () => call(async () => void (await gmail.users.stop({ userId: "me" }))),
  };
}
