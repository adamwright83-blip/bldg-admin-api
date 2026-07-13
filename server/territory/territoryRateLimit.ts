const windows = new Map<string, { count: number; resetAt: number }>();

export function assertTerritoryPreviewRateLimit(key: string, now = Date.now()): void {
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return;
  }
  if (current.count >= 5) throw new Error("Territory preview rate limit exceeded");
  current.count += 1;
}

export function resetTerritoryRateLimitsForTests(): void {
  windows.clear();
}
