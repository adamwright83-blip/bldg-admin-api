import { useEffect, useState } from "react";
import { draftStatusLine, gmailComposeUrl, type ActivationView } from "@shared/firstTenMinutesActivation";
import type { DraftView } from "@shared/firstTenMinutesChapter";
import styles from "./send.module.css";

/**
 * The message leaves the table the person's way: their own Gmail opens with it ready, or they copy it. The page says
 * exactly that, records only that, and then asks. Nothing is shown as sent unless they said so or their own Sent
 * folder shows it.
 */
export function SendDesk({
  draft,
  activation,
  onHandOff,
  onReport,
  onVerify,
}: {
  draft: DraftView;
  activation: ActivationView;
  onHandOff: (channel: "gmail" | "copy") => Promise<void>;
  onReport: (outcome: "sent" | "not_yet") => Promise<void>;
  onVerify: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  // the browser wouldn't copy it: the message is shown to copy by hand, and stays at the table until they have
  const [copyByHand, setCopyByHand] = useState(false);
  const recipient = draft.to.name?.split(/\s+/)[0] ?? draft.to.address;
  const message = `To: ${draft.to.name ? `${draft.to.name} <${draft.to.address}>` : draft.to.address}\nSubject: ${draft.subject}\n\n${draft.body}`;
  const waiting = draft.status === "handed_off" || draft.status === "reported_sent";

  // back from their mail, look in their Sent folder (and every little while, while it's out)
  useEffect(() => {
    if (!waiting || !activation.canOpenInGmail) return;
    const look = () => void onVerify().catch(() => undefined);
    window.addEventListener("focus", look);
    const timer = window.setInterval(look, 10_000);
    return () => {
      window.removeEventListener("focus", look);
      window.clearInterval(timer);
    };
  }, [waiting, activation.canOpenInGmail, onVerify]);

  async function act(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }

  function openGmail() {
    // opened in the click itself, so the browser lets the new tab open; recorded alongside
    window.open(gmailComposeUrl({ to: draft.to.address, subject: draft.subject, body: draft.body, account: activation.gmailAccount }), "_blank", "noopener");
    void act(() => onHandOff("gmail"));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      setCopyByHand(true);
      return;
    }
    await act(() => onHandOff("copy"));
  }

  const status = draftStatusLine(draft.status, draft);

  return (
    <section className={styles.sendDesk} data-testid="first-ten-send" data-status={draft.status}>
      {draft.status === "prepared" ? (
        <>
          <p className={styles.sendSays} data-testid="first-ten-send-says">
            {activation.canOpenInGmail
              ? `Your message to ${recipient} opens in your own Gmail, ready to send. You send it there. JOYSTICK doesn't send it.`
              : `Copy your message to ${recipient} and send it from your own mail. JOYSTICK doesn't send it.`}
          </p>
          <div className={styles.tableActions}>
            {activation.canOpenInGmail ? (
              <button type="button" className={styles.tableMain} disabled={busy} onClick={openGmail}>
                Open in Gmail
              </button>
            ) : null}
            <button type="button" disabled={busy} onClick={() => void copy()}>
              Copy the message
            </button>
          </div>
          {copyByHand ? (
            <div className={styles.copyByHand} data-testid="first-ten-copy-by-hand">
              <p className={styles.sendSays}>Your browser didn't let JOYSTICK copy it. Copy it from here:</p>
              <textarea readOnly value={message} rows={7} aria-label="Your message" onFocus={event => event.currentTarget.select()} />
              <button type="button" disabled={busy} onClick={() => void act(() => onHandOff("copy"))}>
                I've copied it
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className={styles.sendStatus} data-testid="first-ten-send-status">
            {status}
          </p>
          {draft.status === "handed_off" ? (
            <div className={styles.tableActions} data-testid="first-ten-did-it-go">
              <span className={styles.sendAsk}>Did it go?</span>
              <button type="button" disabled={busy} onClick={() => void act(() => onReport("sent"))}>
                I sent it
              </button>
              <button type="button" disabled={busy} onClick={() => void act(() => onReport("not_yet"))}>
                Not yet
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
