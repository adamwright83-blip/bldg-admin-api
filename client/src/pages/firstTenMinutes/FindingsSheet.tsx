import type { FindingPayload, FindingView } from "@shared/firstTenMinutesFindings";
import { sourceDate } from "./SourceNote";
import { Settle } from "./OpeningScenes";
import styles from "./firstTen.module.css";

/** One plain line for a finding. Nothing here adds to what the finding and its sources already say. */
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
    case "estimate":
      return `${payload.title}: ${payload.areas.map(area => area.name).join(", ")}`;
    case "scope":
      return `${payload.from.name ?? payload.from.address} said: ${payload.quote}`;
    case "opportunity":
      return payload.summary;
  }
}

const ORDER: FindingPayload["kind"][] = [
  "opportunity",
  "estimate",
  "scope",
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

/** Everything the crew found, each with where it came from. */
export function FindingsSheet({ findings, onClose }: { findings: FindingView[]; onClose: () => void }) {
  const sorted = [...findings].sort((a, b) => ORDER.indexOf(a.payload.kind) - ORDER.indexOf(b.payload.kind));
  return (
    <div className={styles.scrim} role="dialog" aria-modal="true" aria-label="What your crew found" onClick={onClose}>
      <Settle tilt={0.3}>
        <article className={styles.includes} onClick={event => event.stopPropagation()} data-testid="first-ten-findings">
          <h2>What your crew found</h2>
          {sorted.length === 0 ? <p>Nothing they could stand behind yet.</p> : null}
          <ul className={styles.findingList}>
            {sorted.map(finding => (
              <li key={finding.id} data-kind={finding.payload.kind}>
                <p>{findingLine(finding.payload)}</p>
                {finding.sources.slice(0, 3).map(source => (
                  <small key={`${source.provider}:${source.ref}`}>
                    {source.label}
                    {source.at ? `, ${sourceDate(source.at)}` : ""}: “{source.excerpt}”
                  </small>
                ))}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button type="button" className={styles.inkLink} onClick={onClose} autoFocus>
              Close
            </button>
          </div>
        </article>
      </Settle>
    </div>
  );
}
