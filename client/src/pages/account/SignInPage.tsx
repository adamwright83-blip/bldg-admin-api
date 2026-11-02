import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { takePreviewCodeFromUrl } from "@/lib/previewCode";
import { SIGN_IN_ERRORS, type AccountIntent, type SignInErrorCode } from "@shared/joystickAccount";
import { readFirstTenCredentials, saveFirstTenCredentials } from "../firstTenMinutes/draftStorage";
import styles from "./signIn.module.css";

/**
 * /signup and /login: one "Continue with Google" (server/joystickAccount/googleSignIn.ts). Google proves who the person
 * is; the next screen, in the first ten minutes, asks to read their Gmail, Calendar and Drive. Everything said here
 * about data is what the code does (docs/goldline/JOYSTICK_SIGNUP.md).
 */
const COPY: Record<AccountIntent, { title: string; lede: string; action: string; other: { text: string; label: string; href: string } }> = {
  signup: {
    title: "Welcome to JOYSTICK",
    lede: "Sign up with the Google account you run your business from.",
    action: "Continue with Google",
    other: { text: "Already have an account?", label: "Log in", href: "/login" },
  },
  login: {
    title: "Welcome back",
    lede: "Log in with the Google account you signed up with.",
    action: "Continue with Google",
    other: { text: "New to JOYSTICK?", label: "Sign up", href: "/signup" },
  },
};

const TILES = [
  { title: "Read-only", body: "JOYSTICK reads your mail, calendar and documents. It can't change or delete anything in them." },
  { title: "Nothing sent without you", body: "It never sends an email unless you approve that exact message first." },
  { title: "Yours to take back", body: "Disconnect Google from JOYSTICK, or remove it from your Google Account, at any time." },
];

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function BrandMark() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path d="M32 10H53.847A28 28 0 0 0 86 47.35V64A26 26 0 0 1 60 90H32A26 26 0 0 1 6 64V36A26 26 0 0 1 32 10Z" fill="#fffdf8" />
      <circle cx="82" cy="18" r="16" fill="#e6b944" />
    </svg>
  );
}

function errorFromUrl(): SignInErrorCode | null {
  const code = new URLSearchParams(window.location.search).get("error");
  return code && code in SIGN_IN_ERRORS ? (code as SignInErrorCode) : null;
}

export default function SignInPage({ intent }: { intent: AccountIntent }) {
  const copy = COPY[intent];
  const view = trpc.system.account.view.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const enterPreview = trpc.system.firstTenMinutes.enterPreview.useMutation();
  const begin = trpc.system.account.beginGoogle.useMutation();
  const resume = trpc.system.account.resume.useMutation();
  const signOut = trpc.system.account.signOut.useMutation();
  const [error, setError] = useState<string | null>(() => {
    const code = errorFromUrl();
    return code ? SIGN_IN_ERRORS[code] : null;
  });
  const dialog = useRef<HTMLDialogElement>(null);

  // the crew link works here too (/signup?crew=<code>): taken out of the address bar at startup (lib/previewCode.ts)
  const previewCode = useMemo(() => takePreviewCodeFromUrl(), []);
  useEffect(() => {
    if (!previewCode) return;
    enterPreview.mutateAsync({ code: previewCode }).then(() => view.refetch()).catch(() => undefined);
    // once, with the code this page was opened with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewCode]);

  useEffect(() => {
    document.title = intent === "signup" ? "Sign up · JOYSTICK" : "Log in · JOYSTICK";
    if (errorFromUrl()) window.history.replaceState(null, "", window.location.pathname);
  }, [intent]);

  async function continueWithGoogle() {
    setError(null);
    try {
      // a journey this browser already began through the crew link becomes the new account's, not a stray
      const stored = readFirstTenCredentials();
      const { url } = await begin.mutateAsync({ intent, ...(stored ? { journey: stored } : {}) });
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : SIGN_IN_ERRORS.failed);
    }
  }

  async function continueSignedIn() {
    setError(null);
    try {
      // the same destination as signing in with Google: the workspace, when they have one, or their journey
      const destination = await resume.mutateAsync();
      if (destination.workspace) return window.location.assign("/onboarding");
      if (destination.credentials) saveFirstTenCredentials(destination.credentials);
      window.location.assign("/joystick-start");
    } catch {
      setError(SIGN_IN_ERRORS.failed);
    }
  }

  const signedIn = view.data?.signedIn ?? null;
  const closedToNew = intent === "signup" && view.data && !view.data.open && !signedIn;
  const busy = begin.isPending || resume.isPending;

  return (
    <div className={styles.page} data-testid={`account-${intent}`}>
      <aside className={styles.panel}>
        <a className={styles.brand} href="/" aria-label="JOYSTICK home">
          <BrandMark />
          JOYSTICK
        </a>
        <p className={styles.promise}>Your business, read back to you in a minute. Then you play it.</p>
        <div className={styles.tiles}>
          {TILES.map(tile => (
            <section key={tile.title} className={styles.tile}>
              <h2>{tile.title}</h2>
              <p>{tile.body}</p>
            </section>
          ))}
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.card}>
          <h1>{signedIn ? `Hello again${signedIn.name ? `, ${signedIn.name}` : ""}` : copy.title}</h1>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          {signedIn ? (
            <>
              <p className={styles.lede}>You're signed in as {signedIn.email}.</p>
              <button type="button" className={styles.primary} onClick={() => void continueSignedIn()} disabled={busy} data-testid="account-continue">
                Continue
              </button>
              <p className={styles.switch}>
                Not you?{" "}
                <button type="button" className={styles.link} onClick={() => void signOut.mutateAsync().then(() => view.refetch())} data-testid="account-sign-out">
                  Sign out
                </button>
              </p>
            </>
          ) : closedToNew ? (
            <>
              <p className={styles.lede}>JOYSTICK is invite-only for now. If you were sent a link, open it to sign up.</p>
              <p className={styles.switch}>
                Already have an account? <a href="/login">Log in</a>
              </p>
            </>
          ) : (
            <>
              <p className={styles.lede}>{copy.lede}</p>
              <button
                type="button"
                className={styles.google}
                onClick={() => void continueWithGoogle()}
                disabled={busy || view.isLoading || view.data?.googleReady === false}
                data-testid="account-google"
              >
                <GoogleMark />
                {copy.action}
              </button>
              {view.data?.googleReady === false ? <p className={styles.fine}>Signing in with Google isn't available yet.</p> : null}
              <p className={styles.fine}>
                By continuing you agree to JOYSTICK's <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.
              </p>
              <p className={styles.switch}>
                {copy.other.text} <a href={copy.other.href}>{copy.other.label}</a>
              </p>
            </>
          )}

          <button type="button" className={styles.dataButton} onClick={() => dialog.current?.showModal()}>
            JOYSTICK and your data
          </button>
        </div>
      </main>

      <dialog ref={dialog} className={styles.dialog} aria-labelledby="account-data-title" onClick={event => event.target === dialog.current && dialog.current?.close()}>
        <h2 id="account-data-title">JOYSTICK and your data</h2>
        <h3>Why does JOYSTICK ask for my email, calendar and documents?</h3>
        <p>
          JOYSTICK works out how your business actually runs (who your customers are, what work is in motion, what has gone
          quiet) from what you already do, instead of asking you to fill in forms. Signing in shares only your name and
          email. On the next screen JOYSTICK asks Google for read-only access to Gmail, Calendar and Drive.
        </p>
        <h3>What happens to what it reads?</h3>
        <p>
          Access is read-only, and the keys Google gives JOYSTICK are stored encrypted. To understand what it reads, JOYSTICK
          sends short excerpts to the AI services it uses (Google Gemini and Anthropic Claude), and it looks up your
          business's public listings and public profiles. Your data is never sold. See the <a href="/privacy">Privacy Policy</a>.
        </p>
        <h3>How do I stay in control?</h3>
        <p>
          Nothing is ever sent from your account unless you approve the exact message. You can disconnect Google from
          JOYSTICK at any time, or remove its access in your Google Account settings.
        </p>
        <button type="button" className={`${styles.primary} ${styles.dialogClose}`} onClick={() => dialog.current?.close()}>
          Close
        </button>
      </dialog>
    </div>
  );
}
