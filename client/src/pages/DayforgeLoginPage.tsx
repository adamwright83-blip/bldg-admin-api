import { useState, type FormEvent } from "react";
import "./dayforge-onboarding.css";

function dayforgeApiBase(): string {
  if (
    typeof window !== "undefined" &&
    window.location.hostname.toLowerCase() === "admin.bldg.chat"
  ) {
    return "";
  }
  return import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";
}

export default function DayforgeLoginPage() {
  const [slug, setSlug] = useState(
    import.meta.env.VITE_DAYFORGE_DEMO_MODE === "true"
      ? "sunset-laundry-demo"
      : ""
  );
  const [email, setEmail] = useState(
    import.meta.env.VITE_DAYFORGE_DEMO_MODE === "true"
      ? "demo-owner@sunsetlaundry.example"
      : ""
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${dayforgeApiBase()}/api/dayforge/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, email, password }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Sign in failed");
      window.location.assign("/julydemo");
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
        {import.meta.env.VITE_DAYFORGE_DEMO_MODE === "true" ? (
          <p className="df-onboarding__hint">
            Demo workspace and email are prefilled. Enter the demo password to continue.
          </p>
        ) : null}
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
