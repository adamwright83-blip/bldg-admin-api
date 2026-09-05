import { useEffect, useState } from "react";

export type Capability = { enabled: boolean; active: boolean; tenantId: string | null; businessName: string | null };

/** null while still asking the server. */
export function useDemoCapability() {
  const [capability, setCapability] = useState<Capability | null>(null);
  useEffect(() => {
    let cancelled = false;
    const active = window.sessionStorage.getItem("goldline:demo-context") === "wright-contractors";
    fetch("/api/goldline/demo/capability", {
      credentials: "include",
      headers: active ? { "x-goldline-demo-context": "wright-contractors" } : {},
    })
      .then(response => (response.ok ? response.json() : { enabled: false }))
      .then(data => { if (!cancelled) setCapability(data); })
      .catch(() => { if (!cancelled) setCapability({ enabled: false, active: false, tenantId: null, businessName: null }); });
    return () => { cancelled = true; };
  }, []);
  return capability;
}

/**
 * Development/demo access controls for the WRIGHT CONTRACTORS fixture tenant.
 *
 * These buttons render ONLY when the server reports the demo capability is on
 * (GOLDLINE_DEMO_BYPASS=true). With the flag off the capability endpoint says
 * disabled, this component renders nothing, and the underlying routes 404 — so
 * a normal deploy shows no trace of it and normal auth is untouched.
 */
export function DemoAccess({ onEntered, showLogin = true }: { onEntered: () => void; showLogin?: boolean }) {
  const capability = useDemoCapability();
  const [busy, setBusy] = useState<"login" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!capability?.enabled) return null;

  const call = async (path: string, kind: "login" | "reset") => {
    setBusy(kind);
    setError(null);
    try {
      const response = await fetch(path, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(`Demo request failed (${response.status})`);
      if (kind === "login") window.sessionStorage.setItem("goldline:demo-context", "wright-contractors");
      onEntered();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Demo request failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="gl-demo-access" data-testid="goldline-demo-access">
      <p>DEVELOPMENT / DEMO ACCESS · {capability.businessName}</p>
      <div>
        {showLogin ? <button
          type="button"
          data-testid="goldline-demo-bypass-login"
          disabled={busy !== null}
          onClick={() => call("/api/goldline/demo/bypass-login", "login")}
        >
          {busy === "login" ? "ENTERING…" : "BYPASS LOGIN"}
        </button> : null}
        <button
          type="button"
          data-testid="goldline-demo-reset"
          disabled={busy !== null}
          onClick={() => call("/api/goldline/demo/reset", "reset")}
        >
          {busy === "reset" ? "RESETTING…" : "RESET DEMO ONBOARDING"}
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <small>
        Demo-only. Enters the {capability.businessName} fixture tenant; reset clears only that
        tenant's onboarding progress and returns you to question one.
      </small>
    </section>
  );
}

export function DemoExit() {
  const [busy, setBusy] = useState(false);
  const exit = async () => {
    setBusy(true);
    try {
      await fetch("/api/goldline/demo/exit", { method: "POST", credentials: "include" });
    } finally {
      window.sessionStorage.removeItem("goldline:demo-context");
      window.location.replace("/");
    }
  };
  return <button type="button" className="gl-demo-exit" data-testid="goldline-demo-exit" disabled={busy} onClick={exit}>
    {busy ? "RETURNING…" : "EXIT DEMO / RETURN TO MY GOLDLINE"}
  </button>;
}
