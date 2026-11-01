import type { ActivationView } from "@shared/firstTenMinutesActivation";
import type { FirstTenCredentials } from "../draftStorage";
import { ActivationCard } from "./ActivationCard";
import { WorkspaceKey } from "./WorkspaceKey";
import styles from "../firstTen.module.css";

/**
 * The existing JOYSTICK offer, checkout return, and workspace key. Used at the
 * writing table when a draft exists, and on a kept page when it does not.
 * Sending stays on the table: this component never sends mail.
 */
export function ActivationOffer({
  activation,
  credentials,
  checkout,
  showCard,
  onContinue,
  onBringYourOwn,
}: {
  activation: ActivationView;
  credentials: FirstTenCredentials;
  checkout: "success" | "cancelled" | null;
  showCard: boolean;
  onContinue: (identity: { businessName: string; contactName: string; ownerEmail: string; timeZone: string }) => Promise<void>;
  onBringYourOwn: () => void;
}) {
  return (
    <>
      {checkout === "cancelled" && activation.status !== "active" ? (
        <p className={styles.quiet} data-testid="first-ten-checkout-cancelled">
          Checkout closed. Nothing was charged; everything here is saved.
        </p>
      ) : null}
      {showCard ? (
        activation.status === "checkout_pending" && checkout === "success" ? (
          <p className={styles.quiet} data-testid="first-ten-checkout-pending">
            Your crew is being kept. This takes a moment.
          </p>
        ) : (
          <ActivationCard activation={activation} onBringYourOwn={onBringYourOwn} onContinue={onContinue} />
        )
      ) : null}
      {activation.owner ? <WorkspaceKey activation={activation} credentials={credentials} /> : null}
    </>
  );
}
