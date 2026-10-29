import { SLACK_USER_SCOPES } from "../../shared/firstTenMinutes";
import { providerJson, ProviderError, providerUrl, type FetchLike } from "./providerFetch";

/**
 * Slack OAuth (v2) for the first ten minutes: a user token that can read the person's conversations and never post.
 * Client: JOYSTICK_SLACK_CLIENT_ID / JOYSTICK_SLACK_CLIENT_SECRET (a Slack app with only the user scopes below and
 * each origin's /api/first-ten/oauth/slack/callback as a redirect URL).
 */
const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const ACCESS_URL = "https://slack.com/api/oauth.v2.access";
const REVOKE_URL = "https://slack.com/api/auth.revoke";

type Deps = { fetch?: FetchLike; env?: NodeJS.ProcessEnv };

function client(env: NodeJS.ProcessEnv) {
  return {
    id: env.JOYSTICK_SLACK_CLIENT_ID?.trim() || "",
    secret: env.JOYSTICK_SLACK_CLIENT_SECRET?.trim() || "",
  };
}

export function isSlackConnectConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const c = client(env);
  return Boolean(c.id && c.secret);
}

export function slackAuthorizationUrl(input: { state: string; redirectUri: string }, env: NodeJS.ProcessEnv = process.env): string {
  const c = client(env);
  if (!c.id) throw new Error("Slack connection is not configured");
  const params = new URLSearchParams({
    client_id: c.id,
    user_scope: SLACK_USER_SCOPES.join(","),
    redirect_uri: input.redirectUri,
    state: input.state,
  });
  return providerUrl(`${AUTHORIZE_URL}?${params.toString()}`, env);
}

export type SlackGrant = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  grantedScopes: string[];
  userId: string;
  teamName: string | null;
};

type AccessResponse = {
  ok?: boolean;
  error?: string;
  authed_user?: { id?: string; scope?: string; access_token?: string; refresh_token?: string; expires_in?: number };
  team?: { id?: string; name?: string };
};

export async function exchangeSlackCode(
  input: { code: string; redirectUri: string; now?: Date },
  deps: Deps = {}
): Promise<SlackGrant> {
  const c = client(deps.env ?? process.env);
  const body = await providerJson<AccessResponse>(
    "slack",
    ACCESS_URL,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: c.id,
        client_secret: c.secret,
        redirect_uri: input.redirectUri,
      }).toString(),
    },
    deps
  );
  const user = body.authed_user;
  if (!body.ok || !user?.access_token || !user.id) {
    throw new ProviderError("slack", 502, "Slack returned no user token");
  }
  const now = input.now ?? new Date();
  return {
    accessToken: user.access_token,
    refreshToken: user.refresh_token ?? null,
    expiresAt: user.expires_in ? new Date(now.getTime() + user.expires_in * 1000) : null,
    grantedScopes: (user.scope ?? "").split(",").map(scope => scope.trim()).filter(Boolean),
    userId: user.id,
    teamName: body.team?.name ?? null,
  };
}

export async function revokeSlackToken(token: string, deps: Deps = {}): Promise<boolean> {
  try {
    const body = await providerJson<{ ok?: boolean }>(
      "slack",
      REVOKE_URL,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
      deps
    );
    return Boolean(body.ok);
  } catch {
    return false;
  }
}

/** Reading conversations needs history on at least one kind of conversation. */
export function slackGrantIsUsable(grantedScopes: readonly string[]): boolean {
  return ["channels:history", "groups:history", "im:history", "mpim:history"].some(scope => grantedScopes.includes(scope));
}
