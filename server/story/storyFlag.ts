/**
 * The story season is off unless both are set:
 *   JOYSTICK_STORY_TENANTS  comma-separated tenant ids that see the season (no wildcard)
 *   JOYSTICK_STORY_SEASON   slug of the season those tenants play
 * Unset, empty, or a tenant not on the list: the routes answer `{ enabled: false }` and refuse every write.
 */
export function storyEnabledTenants(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  return new Set(
    (env.JOYSTICK_STORY_TENANTS ?? "")
      .split(",")
      .map(value => value.trim())
      .filter(value => value.length > 0 && value !== "*")
  );
}

export function activeStorySeasonSlug(env: NodeJS.ProcessEnv = process.env): string | null {
  const slug = env.JOYSTICK_STORY_SEASON?.trim();
  return slug ? slug : null;
}

export function isStoryEnabledForTenant(tenantId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return activeStorySeasonSlug(env) !== null && storyEnabledTenants(env).has(tenantId);
}
