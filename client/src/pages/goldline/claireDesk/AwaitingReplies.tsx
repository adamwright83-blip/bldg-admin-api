import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { AwaitingReply } from "@shared/firstTenMinutesKnowledge";

const SHOWN = 6;
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

type Outcome =
  | { status: "sent"; at: string; already: boolean }
  | { status: "sending" }
  | { status: "needs_permission"; composeUrl: string }
  | { status: "failed"; reason: string }
  | { status: "replied" };

export function outcomeLine(outcome: Outcome): string {
  switch (outcome.status) {
    case "sent":
      return `${outcome.already ? "Already sent" : "Sent"} from your Gmail at ${new Date(outcome.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`;
    case "sending":
      return "Sending… JOYSTICK shows it as sent only once Gmail confirms it.";
    case "needs_permission":
      return "JOYSTICK doesn't have permission to send from your Gmail. Open it in Gmail to send it there.";
    case "failed":
      return `Gmail didn't send it: ${outcome.reason}. Nothing went.`;
    case "replied":
      return "They've written back since, so nothing was sent.";
  }
}

/** One follow-up, as the owner reads, edits and approves it. Nothing goes until they press the button. */
function FollowUp({ item, onDone }: { item: AwaitingReply; onDone: () => void }) {
  const prepare = trpc.system.firstTenMinutes.prepareFollowUp.useMutation();
  const send = trpc.system.firstTenMinutes.sendFollowUp.useMutation();
  const [body, setBody] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const draft = prepare.data;

  if (!draft) {
    return (
      <button
        type="button"
        className="cd-chip"
        disabled={prepare.isPending}
        onClick={() => void prepare.mutateAsync({ messageId: item.messageId, timeZone: zone() }).then(d => setBody(d.mail.body))}
        data-testid="claire-desk-follow-up-prepare"
      >
        {prepare.isPending ? "Preparing…" : "Prepare a follow-up"}
      </button>
    );
  }
  const words = body ?? draft.mail.body;
  return (
    <div className="cd-follow-up" data-testid="claire-desk-follow-up">
      <p className="cd-fine">
        To {draft.mail.to.name ?? draft.mail.to.address} &lt;{draft.mail.to.address}&gt; · {draft.mail.subject}
      </p>
      <textarea value={words} rows={5} onChange={event => setBody(event.target.value)} aria-label="Your follow-up" data-testid="claire-desk-follow-up-body" />
      {draft.alreadySent ? <p className="cd-fine">A follow-up already went on {new Date(draft.alreadySent.at).toLocaleDateString()}.</p> : null}
      <div className="cd-chips">
        {draft.canSend && !draft.alreadySent ? (
          <button
            type="button"
            className="cd-gold"
            disabled={send.isPending || !words.trim()}
            onClick={() =>
              void send
                .mutateAsync({ messageId: item.messageId, to: draft.mail.to, subject: draft.mail.subject, body: words })
                .then(result => {
                  setOutcome(result as Outcome);
                  if (result.status === "sent" || result.status === "replied") onDone();
                })
                .catch(error => setOutcome({ status: "failed", reason: error instanceof Error ? error.message : "something went wrong" }))
            }
            data-testid="claire-desk-follow-up-send"
          >
            {send.isPending ? "Sending…" : `Approve and send from ${draft.sendFrom}`}
          </button>
        ) : null}
        <a
          className="cd-chip"
          href={outcome?.status === "needs_permission" ? outcome.composeUrl : draft.composeUrl}
          target="_blank"
          rel="noreferrer noopener"
          data-testid="claire-desk-follow-up-gmail"
        >
          Open in Gmail
        </a>
      </div>
      {outcome ? (
        <p role={outcome.status === "failed" ? "alert" : "status"} className={outcome.status === "sent" ? "cd-ok" : "cd-fine"} data-testid="claire-desk-follow-up-outcome">
          {outcomeLine(outcome)}
        </p>
      ) : (
        <p className="cd-fine">{draft.canSend ? "Nothing is sent until you approve these exact words." : "JOYSTICK can't send from your Gmail yet; Gmail opens with this message ready."}</p>
      )}
    </div>
  );
}

/**
 * Who the owner is waiting to hear back from, read from their own Gmail: each one a real message in their Sent
 * folder, with how long it has been, a link to open it, and a follow-up they can approve. Nothing is sent, labelled or
 * changed without their approval.
 */
export function AwaitingReplies() {
  const awaiting = trpc.system.firstTenMinutes.myAwaitingReplies.useQuery(undefined, { retry: false, staleTime: 5 * 60_000 });
  const a = awaiting.data;
  if (awaiting.isLoading || !a) return null;
  return (
    <section className="cd-card" aria-label="Waiting to hear back" data-testid="claire-desk-awaiting">
      <p className="cd-kicker">WAITING TO HEAR BACK</p>
      {a.unavailable ? (
        <p className="cd-muted" data-testid="claire-desk-awaiting-unavailable">
          {a.unavailable}
        </p>
      ) : a.items.length ? (
        <ul className="cd-ready">
          {a.items.slice(0, SHOWN).map(item => (
            <li key={item.messageId} data-testid="claire-desk-awaiting-item">
              <strong>{item.person.name ?? item.person.address}</strong> · {item.waitingDays} days
              {item.asked ? " · you asked a question" : ""}
              <br />
              <small>
                “{item.subject}”{" "}
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer noopener">
                    open
                  </a>
                ) : null}
              </small>
              <FollowUp item={item} onDone={() => void awaiting.refetch()} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="cd-muted" data-testid="claire-desk-awaiting-none">
          Nobody you wrote to in the last {a.scanned.days} days still owes you a reply.
        </p>
      )}
      <p className="cd-fine">
        Read from {a.account ?? "your Gmail"} at {new Date(a.checkedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}. Ask Claire what to do
        about any of them.
      </p>
    </section>
  );
}
