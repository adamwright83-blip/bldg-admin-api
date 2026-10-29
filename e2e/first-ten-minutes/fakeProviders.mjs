#!/usr/bin/env node
/**
 * A local stand-in for Google and Slack, for the first-ten-minutes end-to-end run only.
 *
 * The server reaches it through JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN, which server/firstTenMinutes/providerFetch.ts
 * honours only outside production: `https://<host>/<path>` becomes `<this origin>/<host>/<path>`. The browser reaches
 * it the same way, because the consent URL the server hands out is rewritten too.
 *
 *   node e2e/first-ten-minutes/fakeProviders.mjs            (listens on 127.0.0.1:4999, or FAKE_PROVIDERS_PORT)
 *
 * POST /__control with JSON changes what the next consent returns: { googleScopes: [...], deny: true } and so on.
 * POST /__reset puts everything back.
 */
import http from "node:http";

const PORT = Number(process.env.FAKE_PROVIDERS_PORT || 4999);

const ALL_GOOGLE_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

const defaults = () => ({
  googleScopes: ALL_GOOGLE_SCOPES,
  googleEmail: "owner@first-ten.example",
  deny: false,
  slackTeam: "First Ten Workspace",
});
let control = defaults();
const revoked = [];

function send(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain" : "application/json", ...headers });
  res.end(text);
}

function readBody(req) {
  return new Promise(resolve => {
    let data = "";
    req.on("data", chunk => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

function consent(url, res, code) {
  const redirect = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  if (!redirect || !state) return send(res, 400, "missing redirect_uri or state");
  const back = new URL(redirect);
  if (control.deny) back.searchParams.set("error", "access_denied");
  else back.searchParams.set("code", code);
  back.searchParams.set("state", state);
  res.writeHead(302, { location: back.toString() });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const body = req.method === "POST" ? await readBody(req) : "";
  const path = url.pathname;

  if (path === "/__control" && req.method === "POST") {
    control = { ...control, ...JSON.parse(body || "{}") };
    return send(res, 200, { ok: true, control });
  }
  if (path === "/__reset" && req.method === "POST") {
    control = defaults();
    revoked.length = 0;
    return send(res, 200, { ok: true });
  }
  if (path === "/__revoked") return send(res, 200, { revoked });

  // ---------------------------------------------------------------- Google
  if (path === "/accounts.google.com/o/oauth2/v2/auth") return consent(url, res, "fake-google-code");
  if (path === "/oauth2.googleapis.com/token" && req.method === "POST") {
    const form = new URLSearchParams(body);
    if (form.get("grant_type") === "refresh_token") {
      return send(res, 200, { access_token: `fake-google-access-${Date.now()}`, expires_in: 3599, scope: control.googleScopes.join(" ") });
    }
    if (form.get("code") !== "fake-google-code") return send(res, 400, { error: "invalid_grant" });
    return send(res, 200, {
      access_token: "fake-google-access",
      refresh_token: "fake-google-refresh",
      expires_in: 3599,
      scope: control.googleScopes.join(" "),
      token_type: "Bearer",
    });
  }
  if (path === "/openidconnect.googleapis.com/v1/userinfo") {
    return send(res, 200, { sub: "fake-sub-1", email: control.googleEmail, email_verified: true, name: "First Ten Owner", given_name: "Owner" });
  }
  if (path === "/oauth2.googleapis.com/revoke" && req.method === "POST") {
    revoked.push({ provider: "google", token: new URLSearchParams(body).get("token") });
    return send(res, 200, {});
  }

  // ---------------------------------------------------------------- Slack
  if (path === "/slack.com/oauth/v2/authorize") return consent(url, res, "fake-slack-code");
  if (path === "/slack.com/api/oauth.v2.access" && req.method === "POST") {
    const form = new URLSearchParams(body);
    if (form.get("code") !== "fake-slack-code") return send(res, 200, { ok: false, error: "invalid_code" });
    return send(res, 200, {
      ok: true,
      authed_user: { id: "UFAKE1", scope: "channels:read,channels:history,users:read,search:read", access_token: "xoxp-fake", token_type: "user" },
      team: { id: "TFAKE1", name: control.slackTeam },
    });
  }
  if (path === "/slack.com/api/auth.revoke" && req.method === "POST") {
    revoked.push({ provider: "slack" });
    return send(res, 200, { ok: true, revoked: true });
  }

  send(res, 404, `fake providers: nothing at ${path}`);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fake providers listening on http://127.0.0.1:${PORT}`);
});
