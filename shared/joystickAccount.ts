/**
 * JOYSTICK accounts (server/joystickAccount): sign up and log in with Google, before any workspace exists.
 */
export type AccountIntent = "signup" | "login";

/** Why the Google round trip came back without signing the person in (/signup?error=…, /login?error=…). */
export type SignInErrorCode = "cancelled" | "expired" | "failed" | "closed" | "invite_only";

export const SIGN_IN_ERRORS: Record<SignInErrorCode, string> = {
  cancelled: "You didn't finish with Google. Nothing was saved.",
  expired: "That took a little too long. Try again.",
  failed: "Something went wrong signing you in. Try again.",
  closed: "JOYSTICK isn't open for sign-ups right now.",
  invite_only: "JOYSTICK is invite-only for now. Use the link you were sent to sign up.",
};

export type AccountView = {
  /** whether this browser may create an account (JOYSTICK_FIRST_TEN_MINUTES `on`, or `preview` with the crew link) */
  open: boolean;
  googleReady: boolean;
  signedIn: { email: string; name: string | null } | null;
};
