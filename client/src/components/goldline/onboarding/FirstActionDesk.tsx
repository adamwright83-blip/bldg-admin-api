import { useState, type FormEvent } from "react";
import { trpc } from "@/lib/trpc";
import {
  openingAnswersReady,
  onboardingPreviewForConnection,
  previewConnectionForSession,
  type GoldlineOnboardingSession,
} from "@shared/goldlineOnboarding";

/**
 * A first action that does not need CleanCloud, a customer file, or a phone.
 * The saved text stays operator-reported.
 */
export function FirstActionDesk({ session }: { session: GoldlineOnboardingSession }) {
  const ready = openingAnswersReady(session);
  const preview = onboardingPreviewForConnection({ connection: previewConnectionForSession(session) });
  const utils = trpc.useUtils();
  const record = trpc.system.goldlineOnboarding.recordFirstAction.useMutation({
    onSuccess: () => { utils.system.goldlineOnboarding.state.invalidate(); },
  });
  const [text, setText] = useState("");
  if (!ready) return null;
  const saved = session.firstAction;

  async function saveTask(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || record.isPending) return;
    await record.mutateAsync({
      kind: "operator_authored_task",
      text,
      version: session.version,
    }).catch(() => undefined);
  }

  async function prepare() {
    if (record.isPending) return;
    await record.mutateAsync({
      kind: "claire_preparation",
      version: session.version,
    }).catch(() => undefined);
  }

  return (
    <section className="gl-first-action" data-testid="onboarding-first-action">
      <p className="gl-eyebrow">FIRST ACTION</p>
      <h2>What you will do next</h2>
      <p>{preview.note}</p>
      <p>
        {preview.illustrative
          ? "No customer connection and no phone needed. Saved as what you report. Not a verified sale or customer result."
          : "Saved as what you report. Not a verified sale or customer result."}
      </p>
      {saved ? (
        <p data-testid="onboarding-first-action-saved">{saved.text}</p>
      ) : (
        <>
          <form onSubmit={saveTask}>
            <label htmlFor="operator-task">Write the next thing you will do</label>
            <textarea
              id="operator-task"
              maxLength={2000}
              value={text}
              onChange={event => setText(event.target.value)}
              placeholder="Example: send the estimate I already wrote"
              disabled={record.isPending}
            />
            <button type="submit" disabled={record.isPending || !text.trim()}>
              {record.isPending ? "SAVING…" : "SAVE THIS TASK"}
            </button>
          </form>
          <button type="button" disabled={record.isPending} onClick={() => void prepare()}>
            PREPARE WITH CLAIRE
          </button>
        </>
      )}
      {record.error ? <p role="alert">{record.error.message}</p> : null}
    </section>
  );
}
