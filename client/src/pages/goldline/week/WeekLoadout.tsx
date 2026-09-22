import React from "react";
import type { WeekArtifactReadiness } from "./lockedWeeklyIntentToWeekArtifact";
import { shortWeekday, weekdayLabel } from "./lockedWeeklyIntentToWeekArtifact";

/**
 * Diegetic prep. The object is the status.
 * Open = loose. Ready = packed. Blocked = held. No checks, no bars.
 */
export function WeekLoadoutItem({ item }: { item: WeekArtifactReadiness }) {
  const by =
    item.completeByDate === item.neededForDate
      ? shortWeekday(item.completeByDate)
      : weekdayLabel(item.completeByDate);
  return (
    <figure
      className={`wb-kit wb-kit--${item.kind} wb-kit--${item.status}`}
      data-kind={item.kind}
      data-status={item.status}
    >
      <LoadoutGlyph kind={item.kind} status={item.status} />
      <figcaption>
        <strong>{item.text}</strong>
        <small>By {by}</small>
      </figcaption>
    </figure>
  );
}

export function ForwardingTagMark({ label }: { label: string }) {
  return (
    <p className="wb-forward" data-testid="week-forwarding">
      <span>{label}</span>
    </p>
  );
}

function LoadoutGlyph({
  kind,
  status,
}: {
  kind: WeekArtifactReadiness["kind"];
  status: WeekArtifactReadiness["status"];
}) {
  const held = status === "blocked";
  return (
    <svg
      className="wb-kit-art"
      viewBox="0 0 72 64"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "physical" && <Jacket packed={status === "ready"} held={held} />}
      {kind === "document" && <Packet packed={status === "ready"} held={held} />}
      {kind === "information" && <Dossier packed={status === "ready"} held={held} />}
      {kind === "approval" && <Permit packed={status === "ready"} held={held} />}
      {kind === "location" && <MapSlip packed={status === "ready"} held={held} />}
      {held && <HoldTag />}
    </svg>
  );
}

function Jacket({ packed, held }: { packed: boolean; held: boolean }) {
  return (
    <g fill="none" stroke={held ? "#8a8174" : "#6b4a28"} strokeWidth="1.6">
      <path
        d={
          packed
            ? "M18 18h36v34H18z"
            : "M16 14l10 6 10-8 10 8 10-6v36H16z"
        }
        fill={packed ? "#e7d3a4" : "#f4e7cc"}
      />
      {!packed && <path d="M30 20v22M42 20v22" />}
      {packed && <path d="M22 24h28M22 32h28" stroke="#a68448" />}
      <circle cx="54" cy="46" r="5" fill="#d7b56a" stroke="#6b4a28" />
    </g>
  );
}

function Packet({ packed, held }: { packed: boolean; held: boolean }) {
  return (
    <g stroke={held ? "#8a8174" : "#6b4a28"} strokeWidth="1.6">
      <rect x="16" y="22" width="34" height="26" fill="#f7f1e2" />
      <rect x="22" y="16" width="34" height="26" fill={packed ? "#efe2c4" : "#fffaf0"} />
      <path d="M22 16l17 12 17-12" fill="none" />
      {packed && <path d="M30 8c8 10 8 10 16 0" fill="none" stroke="#8d5a32" />}
    </g>
  );
}

function Dossier({ packed, held }: { packed: boolean; held: boolean }) {
  return (
    <g stroke={held ? "#8a8174" : "#3e5c4a"} strokeWidth="1.6">
      <rect x="18" y="12" width="36" height="40" rx="2" fill={packed ? "#e7f0e4" : "#f8f4ea"} />
      <path d="M24 22h24M24 30h18M24 38h20" fill="none" />
      {packed && <circle cx="46" cy="42" r="6" fill="#d8eccf" />}
    </g>
  );
}

function Permit({ packed, held }: { packed: boolean; held: boolean }) {
  return (
    <g stroke={held ? "#8a8174" : "#7a3b32"} strokeWidth="1.6">
      <rect x="20" y="10" width="32" height="44" fill="#f8f1e4" />
      <path d="M26 20h20M26 28h16" fill="none" stroke="#6b4a28" />
      {packed && !held && (
        <circle cx="36" cy="40" r="7" fill="none" stroke="#8d3a2a" strokeWidth="2" />
      )}
    </g>
  );
}

function MapSlip({ packed, held }: { packed: boolean; held: boolean }) {
  return (
    <g stroke={held ? "#8a8174" : "#2f5d62"} strokeWidth="1.6">
      <path d="M14 18l14-6 16 6 14-6v36l-14 6-16-6-14 6z" fill={packed ? "#e5f2ef" : "#f7f3e8"} />
      <path d="M28 12v36M44 18v36" fill="none" />
      <circle cx="36" cy="32" r="3" fill={packed ? "#2f5d62" : "none"} />
    </g>
  );
}

function HoldTag() {
  return (
    <g>
      <path d="M40 6h22l-4 10H40z" fill="#f0d2b4" stroke="#7a3b32" strokeWidth="1.4" />
      <text x="43" y="14" fill="#7a3b32" fontSize="7" fontFamily="Georgia, serif">
        HOLD
      </text>
    </g>
  );
}
