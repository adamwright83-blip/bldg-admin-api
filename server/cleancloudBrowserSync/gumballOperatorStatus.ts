/**
 * Operator-facing GUMBALL / Jawbreaker status. Distinguishes capture, parse,
 * validation, database write, and downstream customer-truth assimilation.
 */

export type GumballAssimilationStatus = "refreshed" | "failed" | "skipped";

export type GumballOperatorObservability = {
  lastAttemptAt: string | null;
  lastAttemptOutcome: string | null;
  lastAttemptMessage: string | null;
  lastSuccessAt: string | null;
  storeLabel: string | null;
  rangeFrom: string | null;
  rangeTo: string | null;
  rowsParsed: number | null;
  inserted: number | null;
  updated: number | null;
  unchanged: number | null;
  skipped: number | null;
  unresolvedBuildings: number | null;
  unresolvedGeographyCount: number | null;
  customerTruth: GumballAssimilationStatus | null;
  map: GumballAssimilationStatus | null;
  operatorStatusLine: string;
};

export type GumballOperatorStatusInput = {
  now?: Date;
  lastAttemptAt?: string | Date | null;
  lastAttemptOutcome?: string | null;
  lastAttemptMessage?: string | null;
  lastSuccessAt?: string | Date | null;
  storeLabel?: string | null;
  rangeFrom?: string | null;
  rangeTo?: string | null;
  rowsParsed?: number | null;
  inserted?: number | null;
  updated?: number | null;
  unchanged?: number | null;
  skipped?: number | null;
  unresolvedBuildings?: number | null;
  unresolvedGeographyCount?: number | null;
  customerTruth?: GumballAssimilationStatus | null;
  map?: GumballAssimilationStatus | null;
};

const PACIFIC = "America/Los_Angeles";

function asDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatPacificClock(value: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC,
    hour: "numeric",
    minute: "2-digit",
  }).format(asDate(value) ?? new Date(value));
}

function countPart(count: number | null | undefined, noun: string): string | null {
  if (count == null || !Number.isFinite(count)) return null;
  return `${count} ${noun}`;
}

function attemptStageLine(
  outcome: string | null | undefined,
  message: string | null | undefined
): string | null {
  const value = String(outcome ?? "").toLowerCase();
  const text = String(message ?? "").toLowerCase();
  if (!value) return "export never captured";
  if (value === "extension_export" || value === "extension_failed") {
    return "export never captured";
  }
  if (value === "extension_parse") {
    return "CSV parse rejected";
  }
  if (value === "extension_import") {
    if (
      /\brejected\b|\binvalid\b|\bunrecognized\b|\bpayload\b|\bbinding\b|\baccount changed\b/.test(
        text
      )
    ) {
      return "backend validation rejected";
    }
    return "database import failed";
  }
  if (value === "rejected" || value === "conflict" || value === "unpaired") {
    return "backend validation rejected";
  }
  if (value === "failed" || value === "unavailable") {
    return "database import failed";
  }
  return null;
}

export function formatGumballOperatorStatus(
  input: GumballOperatorStatusInput
): string {
  const attemptAt = asDate(input.lastAttemptAt);
  const successAt = asDate(input.lastSuccessAt);
  const clockSource = attemptAt ?? successAt;
  const prefix = clockSource
    ? `GUMBALL ${formatPacificClock(clockSource)}`
    : "GUMBALL";

  const outcome = String(input.lastAttemptOutcome ?? "");
  if (outcome === "imported" || (!outcome && successAt && input.rowsParsed != null)) {
    const parts = [
      prefix,
      countPart(input.rowsParsed, "rows parsed"),
      countPart(input.inserted, "inserted"),
      countPart(input.updated, "updated"),
    ];
    if ((input.unchanged ?? 0) > 0) {
      parts.push(countPart(input.unchanged, "unchanged"));
    }
    if (input.customerTruth === "failed") {
      parts.push("customer truth failed");
      if (input.map === "refreshed") parts.push("map refreshed");
      else parts.push("map not refreshed");
    } else if (input.customerTruth === "refreshed" && input.map === "refreshed") {
      parts.push("customer truth refreshed");
      parts.push("map refreshed");
    } else if (input.customerTruth === "refreshed") {
      parts.push("customer truth refreshed");
      parts.push("map not refreshed");
    } else {
      parts.push("customer truth not refreshed");
      parts.push("map not refreshed");
    }
    return parts.filter(Boolean).join(" · ");
  }

  const stage = attemptStageLine(outcome, input.lastAttemptMessage);
  if (stage) return `${prefix} · ${stage}`;
  if (!attemptAt && !successAt) return `${prefix} · export never captured`;
  return `${prefix} · ${outcome || "status unknown"}`;
}

export function gumballObservability(
  input: GumballOperatorStatusInput
): GumballOperatorObservability {
  return {
    lastAttemptAt: asDate(input.lastAttemptAt)?.toISOString() ?? null,
    lastAttemptOutcome: input.lastAttemptOutcome ?? null,
    lastAttemptMessage: input.lastAttemptMessage ?? null,
    lastSuccessAt: asDate(input.lastSuccessAt)?.toISOString() ?? null,
    storeLabel: input.storeLabel ?? null,
    rangeFrom: input.rangeFrom ?? null,
    rangeTo: input.rangeTo ?? null,
    rowsParsed: input.rowsParsed ?? null,
    inserted: input.inserted ?? null,
    updated: input.updated ?? null,
    unchanged: input.unchanged ?? null,
    skipped: input.skipped ?? null,
    unresolvedBuildings: input.unresolvedBuildings ?? null,
    unresolvedGeographyCount: input.unresolvedGeographyCount ?? null,
    customerTruth: input.customerTruth ?? null,
    map: input.map ?? null,
    operatorStatusLine: formatGumballOperatorStatus(input),
  };
}
