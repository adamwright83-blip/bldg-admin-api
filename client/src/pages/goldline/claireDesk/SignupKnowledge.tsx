import { trpc } from "@/lib/trpc";
import { signupKnowledgeForBriefing, signupOpeningLine, type OnboardingKnowledge } from "@shared/firstTenMinutesKnowledge";

/** How the person stands with a fact: their own (confirmed or corrected), or only read from their mail. */
export function factStanding(status: OnboardingKnowledge["facts"][number]["status"]): string {
  return status === "confirmed" ? "you confirmed" : status === "changed" ? "your correction" : "read from your accounts";
}

const SHOWN = 12;
const PROVIDER_NAMES: Record<string, string> = { google: "Google account", slack: "Slack" };

/**
 * What the crew learned when the workspace was set up, kept in the workspace: where the first message stands, the
 * opportunity it was for, and the facts with where each came from. Read only; nothing here contacts anyone.
 */
export function SignupKnowledge({ timeZone }: { timeZone: string }) {
  const knowledge = trpc.system.firstTenMinutes.myKnowledge.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const k = knowledge.data;
  if (!k) return null;
  const briefing = signupKnowledgeForBriefing(k, timeZone);
  const line = signupOpeningLine(briefing, timeZone, new Date());
  const facts = k.facts.filter(fact => fact.kind !== "business" && fact.kind !== "owner");
  const read = briefing?.readAt ?? null;
  return (
    <section className="cd-card" aria-label="From your signup" data-testid="claire-desk-signup">
      <p className="cd-kicker">FROM YOUR SIGNUP{read ? ` · READ ${read}` : ""}</p>
      {line ? (
        <p className="cd-says" data-testid="claire-desk-signup-message">
          {line}
        </p>
      ) : null}
      {k.opportunity ? (
        <p className="cd-small" data-testid="claire-desk-signup-opportunity">
          {k.opportunity.person.name ?? k.opportunity.person.address} asked about {k.opportunity.wants}
          {k.opportunity.askedAt ? ` (${new Date(k.opportunity.askedAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })})` : ""}.
        </p>
      ) : null}
      {facts.length ? (
        <details data-testid="claire-desk-signup-facts">
          <summary>What the crew learned ({facts.length})</summary>
          <ul className="cd-ready">
            {facts.slice(0, SHOWN).map(fact => (
              <li key={fact.id} data-status={fact.status}>
                {fact.statement}{" "}
                <small>
                  ({factStanding(fact.status)}
                  {fact.sources[0] ? ` · ${fact.sources[0].label}` : ""})
                </small>
              </li>
            ))}
          </ul>
          {facts.length > SHOWN ? <p className="cd-fine">And {facts.length - SHOWN} more Claire can tell you about.</p> : null}
        </details>
      ) : null}
      <p className="cd-fine">
        Read from your own {k.readFrom.map(source => PROVIDER_NAMES[source.provider] ?? source.provider).join(" and ") || "accounts"} when you signed up. History, not today's numbers; tell Claire
        what's changed.
      </p>
    </section>
  );
}
