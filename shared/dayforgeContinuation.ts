const MAX_INTERNAL_RETURN_LENGTH = 2_048;
const INTERNAL_ORIGIN = "https://dayforge.internal";
const DISALLOWED_DESTINATIONS = new Set([
  "/dayforge-login",
  "/dayforge-onboarding",
  "/julydemo",
]);
const SECRET_QUERY_KEYS = new Set([
  "handoff",
  "preview",
  "previewtoken",
  "resumetoken",
  "continuation",
  "continuationtoken",
  "token",
  "code",
  "state",
]);

export type DayforgeAuthenticatedDestinationKind =
  | "secure_mission_handoff"
  | "preview_continuation"
  | "internal_return_to"
  | "dayforge_today";

export type DayforgeAuthenticatedDestination = {
  destination: string;
  destinationKind: DayforgeAuthenticatedDestinationKind;
};

function containsControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function hasEncodedSeparator(value: string): boolean {
  return /%(?:2f|5c)/i.test(value);
}

export function validateInternalReturnTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (
    !candidate ||
    candidate.length > MAX_INTERNAL_RETURN_LENGTH ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    containsControlCharacters(candidate) ||
    hasEncodedSeparator(candidate)
  ) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    return null;
  }
  if (
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    containsControlCharacters(decoded)
  ) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate, INTERNAL_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== INTERNAL_ORIGIN || DISALLOWED_DESTINATIONS.has(parsed.pathname)) {
    return null;
  }

  for (const key of Array.from(parsed.searchParams.keys())) {
    if (SECRET_QUERY_KEYS.has(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  if (
    parsed.hash &&
    Array.from(SECRET_QUERY_KEYS).some(key =>
      new RegExp(`(?:^|[&#])${key}=`, "i").test(parsed.hash.slice(1))
    )
  ) {
    parsed.hash = "";
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function defaultDayforgeDestination(): DayforgeAuthenticatedDestination {
  return {
    destination: "/dayforge-today",
    destinationKind: "dayforge_today",
  };
}
