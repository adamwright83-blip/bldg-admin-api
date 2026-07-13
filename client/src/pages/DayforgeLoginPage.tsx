import { useState, type FormEvent } from "react";
import "./dayforge-onboarding.css";

export default function DayforgeLoginPage() {
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const apiBase = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";
      const response = await fetch(`${apiBase}/api/dayforge/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, email, password }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Sign in failed");
      window.location.assign("/dayforge-settings");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="df-onboarding">
      <section className="df-onboarding__card df-onboarding__card--compact">
        <div className="df-onboarding__mark" aria-hidden="true">
          D
        </div>
        <p className="df-onboarding__eyebrow">DAYFORGE SIGN IN</p>
        <h1>Return to the mission.</h1>
        {error ? (
          <p className="df-onboarding__error" role="alert">
            {error}
          </p>
        ) : null}
        <form onSubmit={submit} className="df-onboarding__form">
          <label>
            Workspace slug
            <input
              autoComplete="organization"
              value={slug}
              onChange={event => setSlug(event.target.value)}
              required
            />
          </label>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={event => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
            />
          </label>
          <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </section>
    </main>
  );
}
