import { useState, type FormEvent } from "react";
import { ACTIVATION_COPY, type ActivationView } from "@shared/firstTenMinutesActivation";
import { firstTenHandoffUrl, readFirstTenCredentials } from "../draftStorage";
import styles from "./send.module.css";

/**
 * The moment the prepared message has value: keep the crew. Astra's words, the actual offer stated plainly, and what
 * JOYSTICK already knows for the person to confirm. Checkout returns here, to this message.
 */
export function ActivationCard({
  activation,
  onContinue,
  onBringYourOwn,
}: {
  activation: ActivationView;
  onContinue: (identity: { businessName: string; contactName: string; ownerEmail: string; timeZone: string }) => Promise<void>;
  onBringYourOwn: () => void;
}) {
  const [businessName, setBusinessName] = useState(activation.identity.businessName ?? "");
  const [contactName, setContactName] = useState(activation.identity.contactName ?? "");
  const [ownerEmail, setOwnerEmail] = useState(activation.identity.ownerEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // a checkout already opened keeps the identity it was opened with; continuing picks that checkout up again
  const pending = activation.status === "checkout_pending";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await onContinue({
        businessName,
        contactName,
        ownerEmail,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Checkout didn't open. Everything here is saved.");
      setBusy(false);
    }
  }

  return (
    <section className={styles.activation} data-testid="first-ten-activation" data-required={activation.required ? "yes" : "no"}>
      <h2 className={styles.activationHeading}>{ACTIVATION_COPY.heading}</h2>
      <p className={styles.activationWaiting}>{ACTIVATION_COPY.waiting}</p>
      {activation.example ? (
        <p className={styles.activationOffer} data-testid="first-ten-activation-example">
          This is Nina's example, so nothing here is activated or sent.{" "}
          <button type="button" className={styles.inlineLink} onClick={onBringYourOwn}>
            Bring your own
          </button>
        </p>
      ) : activation.offer && typeof window !== "undefined" && window.location.origin !== activation.returnOrigin ? (
        <p className={styles.activationOffer} data-testid="first-ten-activation-elsewhere">
          <strong>{activation.offer.line}</strong> {activation.offer.detail} Checkout comes back to {new URL(activation.returnOrigin).host}, so
          this journey goes there first, exactly as it is.{" "}
          <button
            type="button"
            className={styles.inlineLink}
            onClick={() => {
              const credentials = readFirstTenCredentials();
              if (credentials) window.location.assign(firstTenHandoffUrl(activation.returnOrigin, credentials));
            }}
          >
            Continue on {new URL(activation.returnOrigin).host}
          </button>
        </p>
      ) : activation.offer ? (
        <form className={styles.activationForm} onSubmit={event => void submit(event)}>
          <p className={styles.activationOffer} data-testid="first-ten-offer">
            <strong>{activation.offer.line}</strong> {activation.offer.detail}
          </p>
          <div className={styles.activationFields}>
            <label>
              Business
              <input value={businessName} onChange={event => setBusinessName(event.target.value)} maxLength={255} required readOnly={pending} />
            </label>
            <label>
              Your name
              <input value={contactName} onChange={event => setContactName(event.target.value)} maxLength={255} required readOnly={pending} />
            </label>
            <label>
              Email
              <input type="email" value={ownerEmail} onChange={event => setOwnerEmail(event.target.value)} maxLength={320} required readOnly={pending} />
            </label>
          </div>
          <button type="submit" className={styles.activationButton} disabled={busy}>
            {ACTIVATION_COPY.button}
          </button>
          {problem ? (
            <p className={styles.activationProblem} role="alert">
              {problem}
            </p>
          ) : null}
        </form>
      ) : (
        <p className={styles.activationOffer} data-testid="first-ten-offer-closed">
          {ACTIVATION_COPY.closed}
        </p>
      )}
    </section>
  );
}
