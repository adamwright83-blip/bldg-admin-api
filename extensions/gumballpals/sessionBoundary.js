/** Gumball must not drive the operator's personal Google Messages web session. */
export const GUMBALL_FORBIDDEN_MESSAGE_ORIGINS = [
  "https://messages.google.com",
  "https://messages.android.com",
];

export function assertNotGoogleMessagesUrl(raw) {
  if (!raw || typeof raw !== "string") return;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  if (GUMBALL_FORBIDDEN_MESSAGE_ORIGINS.includes(url.origin)) {
    throw new Error(
      "BLOCKED: Gumball must not attach to Google Messages. That would risk displacing the operator's existing personal web session. Nobody was signed out."
    );
  }
}
