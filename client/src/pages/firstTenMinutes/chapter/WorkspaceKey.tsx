import { useState, type FormEvent } from "react";
import { trpc } from "@/lib/trpc";
import { apiBase } from "@/lib/apiBase";
import { WORKSPACE_COPY, type ActivationView } from "@shared/firstTenMinutesActivation";
import type { FirstTenCredentials } from "../draftStorage";
import styles from "./send.module.css";

/**
 * Where a new owner goes once signed in: the same first run today's funnel sends a new JOYSTICK owner to
 * (JoystickAcquisitionPage), the Goldline onboarding that builds their world; a finished one goes on to the world.
 */
export const WORKSPACE_HOME = "/onboarding";
/** A workspace whose owner already has a password: sign in, then home. */
export const WORKSPACE_SIGN_IN = `/dayforge-login?returnTo=${encodeURIComponent(WORKSPACE_HOME)}`;

/** The owner's own sign-in, the way today's funnel does it (JoystickAcquisitionPage): the password they just made. */
export async function signInOwner(email: string, password: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${apiBase()}/api/dayforge/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Your password is set, but signing in didn't work. Sign in from the workspace page.");
  }
}

/**
 * The workspace the person paid for, opened. Provisioning creates it with no one who can sign in, so the owner
 * creates a password here (server/saas activateOwner, the same step today's funnel has) and goes in signed in.
 */
export function WorkspaceKey({ activation, credentials }: { activation: ActivationView; credentials: FirstTenCredentials }) {
  const activate = trpc.system.saas.activateOwner.useMutation();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const email = activation.identity.ownerEmail;
  if (!activation.owner || activation.example) return null;

  if (activation.owner === "ready") {
    return (
      <section className={styles.activation} data-testid="first-ten-workspace" data-owner="ready">
        <h2 className={styles.activationHeading}>{WORKSPACE_COPY.heading}</h2>
        <a className={styles.activationButton} href={WORKSPACE_SIGN_IN} data-testid="first-ten-workspace-open">
          {WORKSPACE_COPY.ready}
        </a>
      </section>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email) return;
    setBusy(true);
    setProblem(null);
    try {
      await activate.mutateAsync({
        ...credentials,
        name: activation.identity.contactName?.trim() || activation.identity.businessName?.trim() || email,
        password,
      });
      await signInOwner(email, password);
      window.location.assign(WORKSPACE_HOME);
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Your workspace didn't open. Try again in a moment.");
      setBusy(false);
    }
  }

  return (
    <section className={styles.activation} data-testid="first-ten-workspace" data-owner="needs_password">
      <h2 className={styles.activationHeading}>{WORKSPACE_COPY.heading}</h2>
      <form className={styles.activationForm} onSubmit={event => void submit(event)}>
        <p className={styles.activationOffer}>{WORKSPACE_COPY.needsPassword.replace("{email}", email ?? "your email")}</p>
        <div className={styles.activationFields}>
          <label>
            Password
            <input
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              aria-describedby="first-ten-workspace-hint"
              required
            />
          </label>
        </div>
        <p id="first-ten-workspace-hint" className={styles.activationWaiting}>
          {WORKSPACE_COPY.passwordHint}
        </p>
        <button type="submit" className={styles.activationButton} disabled={busy || password.length < 12 || !email} data-testid="first-ten-workspace-create">
          {WORKSPACE_COPY.button}
        </button>
        {problem ? (
          <p className={styles.activationProblem} role="alert">
            {problem}
          </p>
        ) : null}
      </form>
    </section>
  );
}
