import { and, desc, eq } from "drizzle-orm";
import type { OnboardingFact, OnboardingKnowledge, OnboardingMessage } from "../../../shared/firstTenMinutesKnowledge";
import { findingLine } from "../../../shared/firstTenMinutesFindingLines";
import { portraitLines } from "../../../shared/firstTenMinutesPortrait";
import { followUpVerdict } from "../../integrations/gmail/replies/trackedConversations";
import { gmailSends } from "../../integrations/gmail/gmailSendLedger";
import { chapterView } from "../chapter/chapter";
import { portraitView } from "../portrait/portrait";
import { portraitRow } from "../portrait/store";
import { firstTenFindings, firstTenJourneys, firstTenReadings } from "../schema";
import { connectionRows, firstTenDb, type JourneyRow } from "../store";
import { understandingView } from "../understanding/view";

/**
 * What JOYSTICK learned about a business in its first ten minutes, read back for the paid workspace that journey
 * became: the journey whose tenant_id is this tenant (set when its checkout provisioned the workspace).
 *
 * Every fact keeps its receipt: the finding id, the person's own reaction to it (confirmed, changed with their
 * correction, or still only proposed), the verbatim sources it rests on, and when it was learned. A finding the person
 * dismissed is not knowledge. A correction always wins over what was read: a fact the person changed is stated in
 * their words, never the original reading's.
 *
 * This is what was read at signup, from the person's own accounts: history, not current business truth. It never
 * becomes a customer, a sale or a booking; the domains that own those still decide them. Read only.
 */
export type { OnboardingFact, OnboardingKnowledge, OnboardingMessage };

const SCOPE_PREFIX = "https://www.googleapis.com/auth/";

/** The newest own journey provisioned into this tenant. */
export async function journeyForTenant(tenantId: string): Promise<JourneyRow | null> {
  const db = await firstTenDb();
  const [row] = await db
    .select()
    .from(firstTenJourneys)
    .where(and(eq(firstTenJourneys.tenantId, tenantId), eq(firstTenJourneys.kind, "own")))
    .orderBy(desc(firstTenJourneys.createdAt))
    .limit(1);
  return row ?? null;
}

export async function readTenantOnboardingKnowledge(tenantId: string): Promise<OnboardingKnowledge | null> {
  if (!tenantId.trim()) return null;
  const journey = await journeyForTenant(tenantId);
  if (!journey) return null;
  return readJourneyKnowledge(journey);
}

export async function readJourneyKnowledge(journey: JourneyRow): Promise<OnboardingKnowledge> {
  const db = await firstTenDb();
  const [reading] = await db.select().from(firstTenReadings).where(eq(firstTenReadings.journeyId, journey.id)).limit(1);
  const understood = await understandingView(journey.id);
  const learned = new Map(
    (await db.select({ id: firstTenFindings.id, createdAt: firstTenFindings.createdAt }).from(firstTenFindings).where(eq(firstTenFindings.journeyId, journey.id))).map(
      row => [row.id, row.createdAt.toISOString()] as const
    )
  );
  const facts: OnboardingFact[] = understood.findings
    .filter(finding => finding.status !== "dismissed")
    .map(finding => ({
      id: finding.id,
      kind: finding.payload.kind,
      statement: finding.status === "changed" && finding.correction?.trim() ? finding.correction.trim() : findingLine(finding.payload),
      status: finding.status as OnboardingFact["status"],
      correction: finding.correction,
      sources: finding.sources.map(source => ({ provider: source.provider, label: source.label, excerpt: source.excerpt, at: source.at, who: source.who, url: source.url ?? null })),
      learnedAt: learned.get(finding.id) ?? reading?.finishedAt?.toISOString() ?? journey.createdAt.toISOString(),
    }));
  const live = new Set(facts.map(fact => fact.id));
  const named = (kind: "business" | "owner") => {
    const fact = facts.find(item => item.kind === kind);
    return fact ? fact.statement.replace(/^You sign as /, "") : null;
  };

  const page = await portraitView(journey.id);
  const portrait =
    page && page.status === "ready"
      ? {
          kept: Boolean((await portraitRow(journey.id))?.keptAt),
          lines: portraitLines(page).map(line => ({ text: line.text, factIds: line.findingIds.filter(id => live.has(id)) })),
        }
      : null;

  const chapter = await chapterView(journey);
  const opportunity = chapter.opportunity
    ? {
        factId: chapter.opportunity.id,
        person: chapter.opportunity.person,
        wants: chapter.opportunity.request.wants,
        askedAt: chapter.opportunity.request.at,
        subject: chapter.opportunity.request.subject,
      }
    : null;
  const message = chapter.draft ? await messageState(journey, chapter.draft) : null;

  return {
    journeyId: journey.id,
    readAt: reading?.finishedAt?.toISOString() ?? null,
    business: named("business"),
    owner: named("owner"),
    readFrom: (await connectionRows(journey.id))
      .filter(row => row.status === "connected")
      .map(row => ({ provider: row.provider, account: row.accountLabel ?? null, scopes: row.grantedScopes.split(/\s+/).filter(Boolean).map(scope => scope.replace(SCOPE_PREFIX, "")) })),
    facts,
    portrait,
    opportunity,
    message,
  };
}

async function messageState(
  journey: JourneyRow,
  draft: NonNullable<Awaited<ReturnType<typeof chapterView>>["draft"]>
): Promise<OnboardingMessage> {
  const db = await firstTenDb();
  const [send] = await db
    .select({ status: gmailSends.status, threadId: gmailSends.gmailThreadId, sentAt: gmailSends.sentAt })
    .from(gmailSends)
    .where(eq(gmailSends.sendKey, `first_ten:${journey.id}`))
    .limit(1);
  const verified = draft.status === "verified_sent";
  const left = verified || draft.status === "reported_sent";
  const sentAt = send?.status === "sent" && send.sentAt ? send.sentAt.toISOString() : (draft.verifiedSentAt ?? draft.reportedSentAt);
  let reply: OnboardingMessage["reply"] = left ? { state: "none_seen" } : { state: "not_sent" };
  if (left && send?.status === "sent") {
    const verdict = await followUpVerdict({ kind: "gmail_send", ref: `first_ten:${journey.id}` });
    if (!verdict.proceed) reply = verdict.reason === "replied" ? { state: "replied", at: verdict.evidence.receivedAt.toISOString() } : { state: "bounced", at: verdict.evidence.receivedAt.toISOString() };
  }
  return {
    to: draft.to,
    subject: draft.subject,
    status: draft.status,
    sentAt: left ? sentAt : null,
    verified,
    gmailThreadId: send?.threadId ?? null,
    reply,
  };
}
