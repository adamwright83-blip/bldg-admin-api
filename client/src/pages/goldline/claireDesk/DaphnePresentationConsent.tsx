import { useState } from "react";
import { trpc } from "@/lib/trpc";

type Choice = "adaptation" | "experimentation";

/**
 * The operator's own consent for how Daphne presents missions. Two separate,
 * affirmative choices; each shows the exact text agreed to and the stored state
 * read back from the server. Nothing here is on by default.
 */
export function DaphnePresentationConsent() {
  const utils = trpc.useUtils();
  const consent = trpc.system.goldlineWorld.presentationConsent.useQuery(undefined, { retry: false });
  const set = trpc.system.goldlineWorld.setPresentationConsent.useMutation();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const c = consent.data;

  async function choose(choice: Choice, granted: boolean) {
    setResult(null);
    try {
      const after = await set.mutateAsync({ choice, granted });
      utils.system.goldlineWorld.presentationConsent.setData(undefined, after);
      void utils.system.goldlineWorld.experimentalPresentationAssignment.invalidate();
      setResult({
        ok: true,
        text:
          choice === "adaptation"
            ? granted ? "Saved: Daphne may adapt how missions are shown." : "Saved: Daphne will not adapt how missions are shown, and comparisons are off."
            : granted ? "Saved: Daphne may compare presentation styles with you." : "Saved: comparisons are off.",
      });
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : "Not saved. Nothing changed." });
    } finally {
      void utils.system.goldlineWorld.presentationConsent.invalidate();
    }
  }

  return (
    <section className="cd-card" aria-label="How missions are shown" data-testid="daphne-presentation-consent">
      <p className="cd-kicker">DAPHNE · HOW MISSIONS ARE SHOWN</p>
      {consent.isLoading ? <p className="cd-muted">Loading your choices…</p> : null}
      {consent.error ? <p role="alert" className="cd-error">Your choices couldn't load: {consent.error.message}</p> : null}
      {c ? (
        <>
          <ConsentRow
            testId="consent-adaptation"
            text={c.text.adaptation}
            on={c.adaptationAllowed}
            busy={set.isPending}
            allowLabel="Allow"
            onChange={granted => void choose("adaptation", granted)}
          />
          <ConsentRow
            testId="consent-experimentation"
            text={c.text.experimentation}
            on={c.experimentationAllowed}
            busy={set.isPending}
            disabledReason={c.adaptationAllowed ? null : "Needs the choice above first."}
            allowLabel="Allow comparisons"
            onChange={granted => void choose("experimentation", granted)}
          />
          {c.experimentationAllowed && !c.experimentsRunning ? (
            <p className="cd-fine" data-testid="consent-experiments-paused">
              Your permission is saved. Comparisons are paused for everyone right now, so nothing is being compared yet.
            </p>
          ) : null}
          <p className="cd-fine">Both are off unless you turn them on. You can also tell Claire "stop experimenting on me".</p>
        </>
      ) : null}
      {result ? (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? "cd-ok" : "cd-error"} data-testid="consent-result">
          {result.text}
        </p>
      ) : null}
    </section>
  );
}

function ConsentRow(props: {
  testId: string;
  text: string;
  on: boolean;
  busy: boolean;
  disabledReason?: string | null;
  allowLabel: string;
  onChange: (granted: boolean) => void;
}) {
  return (
    <div className="cd-consent-row" data-testid={props.testId} data-on={props.on ? "true" : "false"}>
      <p>{props.text}</p>
      <p className="cd-meta">
        <span className={`cd-status ${props.on ? "cd-status-committed" : "cd-status-completed"}`}>{props.on ? "On" : "Off"}</span>
        {props.on ? (
          <button type="button" disabled={props.busy} onClick={() => props.onChange(false)} data-testid={`${props.testId}-stop`}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="cd-gold"
            disabled={props.busy || Boolean(props.disabledReason)}
            onClick={() => props.onChange(true)}
            data-testid={`${props.testId}-allow`}
          >
            {props.allowLabel}
          </button>
        )}
        {!props.on && props.disabledReason ? <span className="cd-fine">{props.disabledReason}</span> : null}
      </p>
    </div>
  );
}
