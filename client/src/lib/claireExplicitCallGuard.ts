const CLAIRE_CALL_BEFORE_DRIVE = "system.claire.callBeforeDrive";
const CLAIRE_TAP_KEY = "goldline:claire-explicit-call-tap";
export const CLAIRE_EXPLICIT_TAP_TTL_MS = 2_500;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
}

export function isClaireCallBeforeDriveRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): boolean {
  return (
    requestMethod(input, init) === "POST" &&
    requestUrl(input).includes(CLAIRE_CALL_BEFORE_DRIVE)
  );
}

export function recordClaireExplicitTap(
  storage: StorageLike,
  now = Date.now()
): void {
  storage.setItem(CLAIRE_TAP_KEY, String(now));
}

export function consumeClaireExplicitTap(
  storage: StorageLike,
  now = Date.now()
): boolean {
  const raw = storage.getItem(CLAIRE_TAP_KEY);
  storage.removeItem(CLAIRE_TAP_KEY);
  if (!raw) return false;

  const tappedAt = Number(raw);
  if (!Number.isFinite(tappedAt)) return false;
  const age = now - tappedAt;
  return age >= 0 && age <= CLAIRE_EXPLICIT_TAP_TTL_MS;
}
