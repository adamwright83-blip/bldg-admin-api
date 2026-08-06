const SAME_ORIGIN_API_HOSTS = new Set(["admin.bldg.chat"]);

export function resolveApiBase(
  hostname: string | undefined,
  configuredApiUrl: string | undefined
): string {
  if (hostname && SAME_ORIGIN_API_HOSTS.has(hostname.toLowerCase())) {
    return "";
  }

  return configuredApiUrl?.replace(/\/$/, "") ?? "";
}

export function apiBase(): string {
  return resolveApiBase(
    typeof window === "undefined" ? undefined : window.location.hostname,
    import.meta.env.VITE_API_URL
  );
}
