import { trpc } from "@/lib/trpc";

const SHOWN = 6;

/**
 * Who the owner is waiting to hear back from, read from their own Gmail: each one a real message in their Sent
 * folder, with how long it has been and a link to open it. Read only: nothing is sent, labelled or changed.
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
