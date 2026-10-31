import type { FindingPayload } from "./firstTenMinutesFindings";

/**
 * Each finding in one plain line, in the person's own terms (the crew's findings sheet). Shared so the paid workspace
 * and Claire say a finding the same way the person first saw it.
 */
export function findingLine(payload: FindingPayload): string {
  switch (payload.kind) {
    case "business":
      return payload.name;
    case "owner":
      return `You sign as ${payload.name}`;
    case "person":
      return `${payload.person.name ?? payload.person.address}: you wrote ${payload.sent}, they wrote ${payload.received}`;
    case "rule":
      return `Your rule: ${payload.quote}`;
    case "promise":
      return `You promised: ${payload.quote}`;
    case "request":
      return `${payload.from.name ?? payload.from.address} asked: ${payload.quote}`;
    case "reply":
      return `You answered ${payload.to.name ?? payload.to.address}: ${payload.quote}`;
    case "service":
      return `You offer: ${payload.name}`;
    case "place":
      return payload.address ? `${payload.name}, ${payload.address}` : payload.name;
    case "habit":
      return `You tend to finish with a real question: ${payload.examples.map(example => `“${example}”`).join(" ")}`;
    case "image":
      return `${payload.name ?? payload.fileName}, sent ${payload.uses} times`;
    case "route":
      return `${payload.title}: ${payload.stops.map(stop => stop.label).join(", ")}`;
    case "rhythm":
      return `${payload.titles.join(", ")}: ${payload.days.map(day => `${WEEKDAYS[day]}s`).join(" and ")}`;
    case "contrast":
      return `${payload.aLine} ${payload.bLine}`;
    case "opportunity":
      return payload.summary;
  }
}

export const FINDING_ORDER: FindingPayload["kind"][] = [
  "opportunity",
  "rule",
  "promise",
  "habit",
  "contrast",
  "place",
  "route",
  "rhythm",
  "image",
  "service",
  "request",
  "reply",
  "person",
  "business",
  "owner",
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
