import { useEffect, useState } from "react";
import { draftStatusLine, type ActivationView } from "@shared/firstTenMinutesActivation";
import type { DraftView } from "@shared/firstTenMinutesChapter";
import styles from "./send.module.css";

export type SendOutcome = "sent" | "sending" | "needs_permission" | "failed";

/**
 * The message leaves the table from inside JOYSTICK, from the person's own Gmail. The page shows exactly what will go
 * and from which account, asks once, naming the recipient, and sends only that. The first time, Google is asked for
 * permission to send. Nothing is shown as sent until Google answered with the message's id (or the Sent folder shows
 * it); an answer that was lost is "sending" while JOYSTICK checks.
 */
export function SendDesk({
  draft,
  activation,
  onSend,
  onAllow,
  onVerify,
  notice = null,
}: {
  draft: DraftView;
  activation: ActivationView;
  /** sends exactly this, as approved */
  onSend: (approved: { to: string; subject: string; body: string }) => Promise<SendOutcome>;
  /** asks Google for permission to send from the connected account */
  onAllow: () => Promise<void>;
  onVerify: () => Promise<void>;
  /** what Google's permission screen came back with, when it didn't allow sending */
  notice?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(notice);
  // Google refused to send despite the stored grant (revoked or narrowed since): ask for permission again
  const [refused, setRefused] = useState(false);
  const name = draft.to.name ?? draft.to.address;
  const firstName = draft.to.name?.split(/\s+/)[0] ?? draft.to.address;
  const recipient = draft.to.name ? `${draft.to.name} <${draft.to.address}>` : draft.to.address;

  // a send whose answer was lost is settled from the Sent folder, every little while
  useEffect(() => {
    if (draft.status !== "sending") return;
    const look = () => void onVerify().catch(() => undefined);
    look();
    const timer = window.setInterval(look, 5_000);
    return () => window.clearInterval(timer);
  }, [draft.status, onVerify]);

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "That didn't work. Nothing was sent; your message is still here.");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    await act(async () => {
      const outcome = await onSend({ to: draft.to.address, subject: draft.subject, body: draft.body });
      setConfirming(false);
      if (outcome === "failed") setProblem("Google didn't send it. Nothing went; your message is still here. You can try again.");
      if (outcome === "needs_permission") {
        setRefused(true);
        setProblem("Google didn't allow JOYSTICK to send from this account. Nothing was sent; allow it again to send from here.");
      }
    });
  }

  if (draft.status !== "prepared") {
    return (
      <section className={styles.sendDesk} data-testid="first-ten-send" data-status={draft.status}>
        <p className={styles.sendStatus} data-testid="first-ten-send-status">
          {draftStatusLine(draft.status, draft)}
        </p>
        {/* still unconfirmed after a while: sending again is offered; JOYSTICK checks Sent first, so it never goes twice */}
        {draft.status === "sending" && draft.handedOffAt && Date.now() - Date.parse(draft.handedOffAt) > 120_000 ? (
          <div className={styles.tableActions}>
            <button type="button" disabled={busy} onClick={() => void send()} data-testid="first-ten-send-again">
              Try sending again
            </button>
          </div>
        ) : null}
        {problem ? (
          <p className={styles.sendProblem} role="alert" data-testid="first-ten-send-problem">
            {problem}
          </p>
        ) : null}
      </section>
    );
  }

  const allowed = Boolean(activation.sendFrom) && activation.canSend && !refused;
  return (
    <section className={styles.sendDesk} data-testid="first-ten-send" data-status={draft.status}>
      <dl className={styles.sendMessage} data-testid="first-ten-send-message">
        <div>
          <dt>From</dt>
          <dd data-testid="first-ten-send-from">{activation.sendFrom ?? "Your Gmail"}</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd data-testid="first-ten-send-to">{recipient}</dd>
        </div>
        <div>
          <dt>Subject</dt>
          <dd>{draft.subject}</dd>
        </div>
        <p className={styles.sendBody}>{draft.body}</p>
      </dl>

      {!allowed ? (
        <>
          <p className={styles.sendSays} data-testid="first-ten-send-says">
            {activation.sendFrom
              ? `To send it from here, Google needs to let JOYSTICK send from ${activation.sendFrom}. JOYSTICK sends only what you approve, one message at a time.`
              : "To send it from here, connect the Gmail you send from. JOYSTICK sends only what you approve, one message at a time."}
          </p>
          <div className={styles.tableActions}>
            <button type="button" className={styles.tableMain} disabled={busy} onClick={() => void act(onAllow)} data-testid="first-ten-allow-send">
              Allow sending from Gmail
            </button>
          </div>
        </>
      ) : confirming ? (
        <div className={styles.sendConfirm} data-testid="first-ten-send-confirm">
          <p className={styles.sendAsk}>
            Send this message to {name} ({draft.to.address}) from {activation.sendFrom}?
          </p>
          <div className={styles.tableActions}>
            <button type="button" className={styles.tableMain} disabled={busy} onClick={() => void send()} data-testid="first-ten-send-now">
              {busy ? "Sending…" : "Send it"}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
              Not yet
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.tableActions}>
          <button type="button" className={styles.tableMain} disabled={busy} onClick={() => setConfirming(true)} data-testid="first-ten-send-start">
            Send to {firstName}
          </button>
        </div>
      )}
      {problem ? (
        <p className={styles.sendProblem} role="alert" data-testid="first-ten-send-problem">
          {problem}
        </p>
      ) : null}
    </section>
  );
}
