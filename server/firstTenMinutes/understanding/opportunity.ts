import type { FindingPayload, OpportunityType } from "../../../shared/firstTenMinutesFindings";
import type { DraftFinding } from "./draft";
import type { WorkExtraction } from "./extract";
import { routeMeetsPlace } from "./places";

/**
 * Ilex: the possibility hidden between two conversations. An opportunity is kept only when its chain holds in the
 * verified findings themselves (a request, the reply that declined it, and a service that exists now, in that order),
 * whoever proposed it. The model may suggest; the chain decides.
 */
type Ids = (key: string) => string;
type Payload<K extends FindingPayload["kind"]> = Extract<FindingPayload, { kind: K }>;

const STOP_WORDS = new Set(["a", "an", "the", "of", "for", "on", "at", "to", "and", "or", "we", "our", "my", "your", "every", "each", "weekly", "regular"]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map(word => word.replace(/(ies|s)$/, match => (match === "ies" ? "y" : "")))
      .filter(word => word.length > 2 && !STOP_WORDS.has(word))
  );
}

/** What was missing then is what exists now: they share a meaningful word ("Friday delivery" / "weekly Friday delivery"). */
export function nowOffers(missing: string, service: Payload<"service">): boolean {
  const need = tokens(missing);
  const have = tokens(`${service.name} ${service.quote}`);
  return [...need].some(word => have.has(word));
}

type Candidate = {
  type: OpportunityType;
  request: DraftFinding & { payload: Payload<"request"> };
  reply: (DraftFinding & { payload: Payload<"reply"> }) | null;
  service: (DraftFinding & { payload: Payload<"service"> }) | null;
  summary: string | null;
};

const is = <K extends FindingPayload["kind"]>(kind: K) => (finding: DraftFinding): finding is DraftFinding & { payload: Payload<K> } =>
  finding.payload.kind === kind;

export function linkOpportunities(findings: DraftFinding[], proposals: WorkExtraction["opportunities"], ids: Ids): DraftFinding[] {
  const requests = findings.filter(is("request"));
  const replies = findings.filter(is("reply"));
  const services = findings.filter(is("service"));
  const places = findings.filter(is("place"));
  const routes = findings.filter(is("route"));
  const byId = new Map(findings.map(finding => [finding.id, finding]));

  const candidates: Candidate[] = [];
  const add = (candidate: Candidate) => {
    if (!candidates.some(existing => existing.request.id === candidate.request.id)) candidates.push(candidate);
  };

  const holds = (request: Candidate["request"], reply: Candidate["reply"], service: Candidate["service"]) =>
    Boolean(
      reply &&
        service &&
        reply.payload.requestId === request.id &&
        reply.payload.declined &&
        new Date(reply.payload.at) >= new Date(request.payload.at) &&
        new Date(service.payload.at) > new Date(reply.payload.at)
    );

  // The model's proposals, checked against the chain.
  for (const proposal of proposals) {
    const request = byId.get(proposal.requestFindingId);
    if (!request || !is("request")(request)) continue;
    const reply = proposal.replyFindingId ? byId.get(proposal.replyFindingId) : undefined;
    const service = proposal.serviceFindingId ? byId.get(proposal.serviceFindingId) : undefined;
    const replyOk = reply && is("reply")(reply) ? reply : null;
    const serviceOk = service && is("service")(service) ? service : null;
    if (proposal.type === "became_possible") {
      if (holds(request, replyOk, serviceOk)) add({ type: "became_possible", request, reply: replyOk, service: serviceOk, summary: proposal.summary });
    } else if (proposal.type === "unanswered") {
      if (!replies.some(candidate => candidate.payload.requestId === request.id)) add({ type: "unanswered", request, reply: null, service: null, summary: proposal.summary });
    } else {
      add({ type: proposal.type, request, reply: replyOk, service: serviceOk, summary: proposal.summary });
    }
  }

  // The same chain found without the model: a reply that named what was missing, and a later service that offers it.
  for (const reply of replies) {
    if (!reply.payload.declined || !reply.payload.missing) continue;
    const request = requests.find(candidate => candidate.id === reply.payload.requestId);
    if (!request) continue;
    const service = services
      .filter(candidate => new Date(candidate.payload.at) > new Date(reply.payload.at) && nowOffers(reply.payload.missing!, candidate.payload))
      .sort((a, b) => new Date(a.payload.at).getTime() - new Date(b.payload.at).getTime())[0];
    if (service) add({ type: "became_possible", request, reply, service, summary: null });
  }

  const scored = candidates.map(candidate => {
    const asker = candidate.request.payload.from.address;
    const place = places.find(
      candidateplace =>
        candidateplace.payload.people.some(person => person.address === asker) ||
        candidateplace.sources.some(source => source.ref === candidate.request.sources[0]?.ref)
    );
    let along: "street" | "nearby" | null = null;
    let route: DraftFinding | null = null;
    if (place) {
      for (const candidateRoute of routes) {
        const meets = routeMeetsPlace(candidateRoute.payload, place.payload);
        if (meets && (!along || meets === "street")) {
          along = meets;
          route = candidateRoute;
        }
      }
    }
    const score =
      (candidate.type === "became_possible" ? 100 : candidate.type === "deserves_finishing" ? 60 : candidate.type === "within_reach" ? 50 : 30) +
      (along === "street" ? 25 : along === "nearby" ? 15 : 0) +
      (place ? 10 : 0) +
      (candidate.request.payload.recurring ? 5 : 0);
    return { candidate, place, route, along, score };
  });

  return scored
    .sort((a, b) => b.score - a.score || new Date(b.candidate.request.payload.at).getTime() - new Date(a.candidate.request.payload.at).getTime())
    .slice(0, 3)
    .map(({ candidate, place, route, along }, index) => ({
      id: ids(`opportunity:${candidate.request.id}`),
      companion: "ilex" as const,
      rank: index,
      payload: {
        kind: "opportunity" as const,
        type: candidate.type,
        person: candidate.request.payload.from,
        requestId: candidate.request.id,
        replyId: candidate.reply?.id ?? null,
        serviceId: candidate.service?.id ?? null,
        routeId: route?.id ?? null,
        placeId: place?.id ?? null,
        along,
        summary: summarize(candidate),
      },
      sources: [
        ...candidate.request.sources,
        ...(candidate.reply?.sources ?? []),
        ...(candidate.service?.sources ?? []),
      ],
    }));
}

/** One factual sentence from the chain itself; the model's summary is used only when it adds nothing unverifiable. */
function summarize(candidate: Candidate): string {
  const who = candidate.request.payload.from.name ?? candidate.request.payload.from.address;
  const when = new Date(candidate.request.payload.at).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  if (candidate.type === "became_possible" && candidate.service) {
    const service = candidate.service.payload.name;
    return `${who} asked in ${when}, before you offered ${service.charAt(0).toLowerCase()}${service.slice(1)}. You offer it now.`;
  }
  if (candidate.type === "unanswered") return `${who} asked in ${when}, and there's no reply yet.`;
  return candidate.summary && candidate.summary.split(/\s+/).length <= 24 && !/\d{3,}/.test(candidate.summary)
    ? candidate.summary
    : `${who} asked in ${when}.`;
}
