/**
 * Google Messages for Web is not a personal-send contract.
 * This module refuses to pair, sign in, sign out, click, or call a private endpoint.
 * A DOM click is not a send. A page load is not a healthy session.
 */

export const GOOGLE_MESSAGES_BROWSER_TRANSPORT = {
  id: "google_messages_web",
  status: "BLOCKED",
  reason:
    "BLOCKED: Google Messages for Web has no documented personal-send contract this service can call. Private endpoints, pairing bypasses, and CAPTCHA bypasses are not used. A DOM click is not proof of send, and the page does not verify the originating phone, the destination, and the resulting message. Opening messages.google.com from the Gumball/Jawbreaker browser would risk displacing the operator's existing personal Google Messages web session, so that pairing is refused and the operator is not signed out. A second browser profile is not created to get around that limit.",
} as const;

export type BrowserTransportAssessment = {
  id: typeof GOOGLE_MESSAGES_BROWSER_TRANSPORT.id;
  status: "BLOCKED";
  evidenceName: "browser_transport_blocked";
  reason: string;
  attempted: false;
  carrierDeliveryObserved: false;
};

export function evaluateGoogleMessagesBrowserTransport(): BrowserTransportAssessment {
  return {
    id: GOOGLE_MESSAGES_BROWSER_TRANSPORT.id,
    status: "BLOCKED",
    evidenceName: "browser_transport_blocked",
    reason: GOOGLE_MESSAGES_BROWSER_TRANSPORT.reason,
    attempted: false,
    carrierDeliveryObserved: false,
  };
}
