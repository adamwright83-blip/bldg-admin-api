<!-- LEGACY DAYFORGE COMPATIBILITY: retained historical environment and route literals below are compatibility identifiers only. Canonical product is JOYSTICK. Today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. -->

# JOYSTICK domain migration audit

Additive front doors onto the existing app and the existing main API. This pass does not attach domains, change DNS, change production env, or replace BLDG hosts.

Epistemic labels:

- **VERIFIED** — observed in this checkout, a test, a Railway read, a Vercel project read, or a public DNS/HTTP header check on 2026-10-16.
- **INFERRED** — supported by that evidence, not a direct setting read.
- **UNKNOWN** — not inspected, or the read was refused.

Classes: **ADD** (this PR), **PRESERVE** (leave forever), **CONFIGURE** (code is ready, a later human step turns it on), **LATER** (do not do until a separate approval), **HISTORICAL** (docs, fixtures, generated artifacts, or a code path that is not the live binding).

## Hard stop

**VERIFIED.** PR #590 (`cursor/joystick-launch-integration-50a9`, head `7c23c616`) is still an open draft. `mergedAt` is null. Its body says not to merge. `drizzle/0134_sms_compose_handoff_audit.sql` and `drizzle/0135_hidden_game_chapter_unlocks.sql` exist only on that branch. They are not on `origin/main` (`b078814a`). This branch does not contain them. Production deployment config was not changed. Production MySQL backup readiness was not re-checked and is not claimed.

## Live bindings observed

Read-only. No domain, DNS, TLS, or env write was performed.

| Host | Live DNS / HTTP | Railway custom domain | Class |
| --- | --- | --- | --- |
| `gojoystick.com` | A `216.198.79.1`, `64.29.17.1`. `HTTP 200`, `server: Vercel`. HTML shell matches `client/index.html`. | not on `bldg-admin-api` | PRESERVE apex marketing |
| `www.gojoystick.com` | CNAME `c99a79d8561a9df9.vercel-dns-017.com`. `HTTP 308` to `https://gojoystick.com/` and preserves path plus query (`/joystick-start?x=1` observed). | not on `bldg-admin-api` | PRESERVE the 308 |
| `app.gojoystick.com` | no A, no CNAME | absent | LATER Vercel + DNS |
| `admin.gojoystick.com` | no A, no CNAME | absent | LATER Vercel + DNS |
| `driver.gojoystick.com` | no A, no CNAME | absent | LATER Vercel + DNS |
| `api.gojoystick.com` | no A, no CNAME | absent from both Railway services | LATER Railway `bldg-admin-api` only |
| `admin.bldg.chat` | CNAME `jg0iikid.up.railway.app`. `server: railway-hikari`, `x-powered-by: Express` | `bldg-admin-api` | PRESERVE |
| `driver.bldg.chat` | CNAME `c99a79d8561a9df9.vercel-dns-017.com`. `server: Vercel`. Same app shell. | also listed on `bldg-admin-api`, but live DNS is Vercel | PRESERVE DNS; Railway listing is not the live edge |
| `api.bldg.chat` | CNAME `scd5gg2z.up.railway.app`. Express on Railway | `bldg-resident` port 8080 | PRESERVE resident API |
| `laundrybutler.bldg.chat` | Vercel DNS, `HTTP 200`, this app shell | not on `bldg-admin-api` | PRESERVE |
| `laundryfarm.bldg.chat` | Vercel DNS, `HTTP 200`, this app shell | not on `bldg-admin-api` | PRESERVE |

**VERIFIED** Railway project `supportive-creation` (`293ee4d1-ee4f-4701-8a56-18ad120009a2`), production environment `330bff45-7d21-4cdf-be04-b38cea76fcfb`:

- `bldg-admin-api` (`9d63863a-2626-47a0-bd65-c3ba8db54258`): `bldg-admin-api-production.up.railway.app`, `admin.bldg.chat`, `driver.bldg.chat`.
- `bldg-resident` (`b9949d56-06f2-4181-bfe5-91e29f87fb4f`): `api.bldg.chat`.

**VERIFIED.** Vercel project `bldg-admin-api` (`prj_8i7YrMmWXB7wWSZhbouHAKWMJFpV`) currently serves `gojoystick.com`. `get_project` and `list_project_domains` without `teamId` returned that project. Domains already on it: `gojoystick.com`, `www.gojoystick.com`, `admin.bldg.chat`, `driver.bldg.chat`, `laundryfarm.bldg.chat`, `laundrybutler.bldg.chat`, plus `bldg-admin-api.vercel.app`, `bldg-admin-api-adamwright83-2158s-projects.vercel.app`, and `bldg-admin-api-git-main-adamwright83-2158s-projects.vercel.app`. `app.gojoystick.com`, `admin.gojoystick.com`, and `driver.gojoystick.com` are absent. The earlier 403 was `GET /v9/projects/{idOrName}/domains` with `teamId` `team_wAwGtg6kKGxTn2GrFFWCg4oh`. The same read without `teamId` succeeded. No domain was attached.

**INFERRED.** These hosts are not behind Cloudflare. Response `server` is `Vercel` or `railway-hikari`. No Cloudflare header was present on the checks above.

## Runtime host contract

Shared classifier: `shared/joystickHostRouting.ts`. The router in `client/src/App.tsx` calls `resolveJoystickHostView` (around lines 717–743).

| Host / path | Surface | Where | Class |
| --- | --- | --- | --- |
| `admin.gojoystick.com` | admin shell, same gate as `admin.bldg.chat` | `App.tsx` `isAdminHost` line 718 | ADD |
| `driver.gojoystick.com` | driver Day Line, `/claire`, capability gaps; other paths redirect to `/` | `App.tsx` `isDriverHost` line 724 and the existing driver block | ADD |
| `app.gojoystick.com` | customer/player app. Membership sign-in. No admin shell, no shared admin password | `client/src/hostRouting/CustomerHostApp.tsx` | ADD |
| `gojoystick.com` `/` | existing `JoystickLanding` | `App.tsx` marketing-root | PRESERVE |
| `gojoystick.com` other paths | existing non-admin switch, unchanged | `resolveJoystickHostView` returns `continue` | PRESERVE |
| `www.gojoystick.com` | 308 to `https://gojoystick.com` + path | `vercel.json` lines 10–22, client fallback `WwwGojoystickRedirect` | ADD in repo, matches live 308 |
| `laundrybutler.bldg.chat` | account / welcome / receipt. Not marketing, admin, driver, or SaaS | `PreservedLaundryHost.tsx` | ADD fence. Root previously fell through to JOYSTICK marketing |
| `laundryfarm.bldg.chat` | `LaundryFarmHome` for every path | `PreservedLaundryHost.tsx` | ADD fence around the existing farm home |
| `admin.bldg.chat`, `driver.bldg.chat` | previous shells | `App.tsx` 718 and 724 | PRESERVE |
| `api.bldg.chat` if this SPA is served there | historical admin shell | `App.tsx` 718 | HISTORICAL SPA alias. Live process is `bldg-resident` |
| `api.gojoystick.com` if this SPA is served there | refusal, not an app | `JoystickApiHostRefused` | ADD guard. Live attach is LATER and must be Railway |
| `*.ops.bldg.chat`, `boreslay.com` | unchanged | `App.tsx` vendor and boreslay branches | PRESERVE |

Customer host allows `/`, `/product`, `/play`, `/onboarding`, `/goldline/start`, `/joystick-start`, `/claire` (desk only), `/growth/lantern-city`, `/goldline-chapter`, `/operator`, settings/billing/invite, and receipts. `/home`, `/admin`, `/pnl`, `/war-room`, `/president`, `/driver/cockpit`, `/claire/*`, and other control-room paths render a refusal. Platform `role === "admin"` is refused on this host. **VERIFIED** by `shared/joystickHostRouting.test.ts` and `client/src/hostRouting/joystickHostRender.test.ts`.

`driver.gojoystick.com` does **not** join the public-driver bypass. `isPublicDriverBypassHost` allows only `bldg-admin-api-production.up.railway.app` and `driver.bldg.chat`. `server/_core/index.ts` calls that function. **PRESERVE.**

## CORS, cookies, API origin

| Item | Evidence | Class |
| --- | --- | --- |
| Exact origins `https://gojoystick.com`, `www`, `app`, `admin`, `driver`, `api` | `JOYSTICK_EXACT_BROWSER_ORIGINS`; spread into `ADMIN_ALLOWED_ORIGINS` at `server/_core/corsConfig.ts` lines 21–24 | ADD |
| No `*.gojoystick.com` | `isAllowedAdminOrigin` has no gojoystick suffix. Test rejects `https://evil.gojoystick.com` and lookalike hosts | ADD |
| Existing `https://*.bldg.chat` suffix | `corsConfig.ts` line 50 | PRESERVE |
| `JOYSTICK_ALLOWED_ORIGINS` env still appended | `configuredAdminOrigins()` | PRESERVE. Do not set a wildcard in production |
| Mutation origin guard | `server/legacy/dayforge/security/legacyDayforgeSecurity.ts` reuses `ADMIN_ALLOWED_ORIGINS` | ADD effect: new exact origins pass the existing cookie-mutation check. Legacy origins stay |
| Session cookie domain | `sessionCookieDomainForHost` returns `undefined` (`server/_core/cookies.ts`). `JOYSTICK_SESSION_COOKIE_DOMAIN` in `server/platform/tenancy/tenantIdentity.ts` stays unset | PRESERVE host-only cookies. A cookie on `admin.bldg.chat` is not sent to `admin.gojoystick.com` |
| OAuth callback | `OAUTH_CALLBACK_REDIRECT_PATH = "/"` (`server/_core/oauth.ts`). Relative, same host. `sdk.ts` does not rewrite the provider redirect URI | PRESERVE code. LATER: the OAuth provider must list new callback URLs or OAuth login on a new host fails |
| Session role | `normalizeSessionRole` in `server/_core/sdk.ts` allows only `admin`, `driver`, or `user` | PRESERVE |
| Same-origin `/api` | `JOYSTICK_SAME_ORIGIN_API_HOSTS` includes `admin.bldg.chat`, `gojoystick.com`, `www`, `app`, `admin`, `driver`, and `api.gojoystick.com`. Not `api.bldg.chat`. Not laundry hosts. A configured resident `VITE_API_URL` is ignored on these hosts | ADD so those hosts use the main API rewrite and cannot follow `VITE_API_URL` to the resident service |
| `/api/:path*` | `vercel.json` → `https://bldg-admin-api-production.up.railway.app/api/:path*` | PRESERVE. This is the main API |
| `/resident-api/:path*` | `vercel.json` → `https://api.bldg.chat/api/:path*` | PRESERVE |
| Dev server hosts | `vite.config.ts` `allowedHosts` adds the six exact gojoystick names. No `.gojoystick.com` suffix | ADD for local Vite only |

`api.gojoystick.com` is same-origin for API calls so it cannot be sent to `api.bldg.chat`, and the SPA still refuses to render an app there (`api-host-refused`). The contract constant `JOYSTICK_MAIN_API_SERVICE_NAME` is `bldg-admin-api`. Public-driver bypass is `isPublicDriverBypassHost`: the Railway production host and `driver.bldg.chat` only.

## Callbacks and checkout left unchanged

| Integration | Runtime | Class |
| --- | --- | --- |
| `ADMIN_BASE_URL` default | `server/_core/env.ts` line 11 and line 69: `https://admin.bldg.chat` | PRESERVE |
| Claire voice, recording, call-status | `server/claire/claireTwilio.ts` `publicBaseUrl()` line 224 uses `ENV.adminBaseUrl`. Paths lines 126–127 | PRESERVE. No prompt, memory, Brain, Showrunner, or Day Line execution edit |
| Conversation Relay WebSocket | `conversationRelayValidationUrl` builds `wss://` from `ENV.adminBaseUrl`. `validateConversationRelayUpgrade` discards `Host` and `X-Forwarded-Host`. `CLAIRE_TWILIO_RELAY_PUBLIC_BASE_URL` stays unset | PRESERVE. The relay does not move to a gojoystick host |
| Twilio signature | `server/claire/conversation/twilioSignature.ts` `isValidTwilioWebhook` | PRESERVE. Empty production signature still fails |
| Stripe success, cancel, portal | `server/saas/saasBilling.ts` lines 29–33, 85–86, 118. Default app URL `https://admin.bldg.chat` via `DAYFORGE_BILLING_APP_URL` | PRESERVE. Checkout return does not move to gojoystick.com in this pass |
| Stripe webhook routes | `/api/dayforge/billing/stripe-webhook`, `/api/marketplace-payments/stripe-webhook` | PRESERVE |
| Unconfigured SaaS checkout | `getLegacyDayforgeBillingStripe()` throws when the secret is absent | PRESERVE fail-closed |
| Marketplace charges | `marketplacePaymentsEnabled()` is false unless `MARKETPLACE_PAYMENTS_ENABLED=true`. Create/capture refuse without calling Stripe | PRESERVE |
| Connect refresh/return | `server/routers.ts` uses `ENV.adminBaseUrl` | PRESERVE |
| Gmail callback default | `server/integrations/cleancloud/browserSync/gmailVerification.ts` `https://admin.gojoystick.com/api/integrations/jawbreaker/gmail/callback` | MOVED 2026-10-20 (admin.bldg.chat retired); the Google OAuth client lists the gojoystick URI |
| Calendar redirect default | `server/googleCalendar/googleCalendarService.ts` line 9 `https://driver.bldg.chat/` | PRESERVE. LATER if driver.gojoystick.com must complete Calendar OAuth |
| Resident reply API | `server/residentFollowups.ts` line 140 defaults to `https://api.bldg.chat` | PRESERVE |
| Resident web origin | `client/src/const.ts` `getResidentWebOrigin` defaults to `https://laundrybutler.bldg.chat` | PRESERVE |
| Welcome handoff origin | `server/welcomeHandoff.ts` line 10 | PRESERVE |
| Campaign link origin | `server/commercialCampaigns/commercialCampaignRouter.ts` line 23 defaults to `https://app.bldg.chat` | PRESERVE. Not replaced with app.gojoystick.com |
| Vendor booking and signup URLs | `vendorsignup.bldg.chat` literals in `server/vendorBookingPublicApi.ts` and `server/_core/index.ts` | PRESERVE |
| Tenant host map | `resolveTenantIdFromHost` matches JOYSTICK platform hosts to tenant id `default` before laundry alias or wildcard rules. That is the same platform tenant id `admin.bldg.chat` already uses. It is not `laundry_farm`. Membership sessions still use the persisted tenant (`tenantForAuthenticatedUser`). Laundry customer sites stay on their own hosts | ADD explicit match. No new tenant row |
| Canonical tags | `client/legacy-dayforge-flagship.html`, `client/codexlfinal.html` still point at `admin.bldg.chat` | HISTORICAL pages. No SEO edit |
| Gumball Pals extension | `extensions/gumballpals/*` still targets `https://admin.bldg.chat` | PRESERVE |
| President workflow base | `.github/workflows/president-autonomous-agent.yml` `https://admin.bldg.chat` | PRESERVE |

No SMS, voice call, Stripe product, price, account, or charge was created.

## Docs, fixtures, and generated artifacts

Mentions of `bldg.chat` under `docs/`, `artifacts/`, `*.test.ts` fixtures, and `scripts/*` demo URLs are **HISTORICAL** unless a row above cites them as runtime. They were not rewritten. A global replace of `bldg.chat` was not done.

## Stage C — still needs Adam's approval

Do not perform these from this PR. Current value is what was observed. Proposed value is the later change. No secret values are included.

### Vercel (existing project that serves this app)

**VERIFIED.** The project is `bldg-admin-api`, id `prj_8i7YrMmWXB7wWSZhbouHAKWMJFpV`. It already has `gojoystick.com`, `www.gojoystick.com`, `admin.bldg.chat`, `driver.bldg.chat`, `laundryfarm.bldg.chat`, `laundrybutler.bldg.chat`, and the three `bldg-admin-api` `vercel.app` aliases named above. `app.gojoystick.com`, `admin.gojoystick.com`, and `driver.gojoystick.com` are absent. Do not attach them in this pass.

| Domain | Current | Proposed later |
| --- | --- | --- |
| `gojoystick.com` | On `prj_8i7YrMmWXB7wWSZhbouHAKWMJFpV`. Live `HTTP 200` marketing shell | No change |
| `www.gojoystick.com` | On the same project. Live Vercel `308` to `https://gojoystick.com` + path/query | No change. This PR's `vercel.json` redirect matches that 308 for when this deployment serves `www` |
| `app.gojoystick.com` | No DNS. Absent from `prj_8i7YrMmWXB7wWSZhbouHAKWMJFpV` | Attach to this project. No redirect |
| `admin.gojoystick.com` | No DNS. Absent from this project | Attach to this project. No redirect. Do not remove `admin.bldg.chat` |
| `driver.gojoystick.com` | No DNS. Absent from this project | Attach to this project. No redirect. Do not remove `driver.bldg.chat` |
| `api.gojoystick.com` | No DNS | Do **not** attach to Vercel. That would serve this SPA, not the API |

### Railway

| Domain | Service | Current | Proposed later |
| --- | --- | --- | --- |
| `api.gojoystick.com` | `bldg-admin-api` `9d63863a-2626-47a0-bd65-c3ba8db54258` | absent | Add custom domain here only |
| `api.gojoystick.com` | `bldg-resident` | absent | Do not add |
| `admin.bldg.chat` | `bldg-admin-api` | present, and it is the live DNS target | No change |
| `driver.bldg.chat` | `bldg-admin-api` | present in Railway, live DNS is Vercel | No change in this pass. Do not delete it while reconciling |
| `api.bldg.chat` | `bldg-resident` | present | No change |

### DNS

| Record | Current | Proposed later |
| --- | --- | --- |
| `gojoystick.com` | Vercel A records | No change |
| `www.gojoystick.com` | CNAME to `c99a79d8561a9df9.vercel-dns-017.com` | No change |
| `app.gojoystick.com` | none | CNAME or A records shown by Vercel when the domain is added. Do not invent them here |
| `admin.gojoystick.com` | none | Same, Vercel instructions for this project |
| `driver.gojoystick.com` | none | Same |
| `api.gojoystick.com` | none | CNAME to the Railway target shown when the custom domain is added on `bldg-admin-api`. Do not point it at `scd5gg2z.up.railway.app` (`bldg-resident`) |
| `admin.bldg.chat`, `driver.bldg.chat`, `api.bldg.chat`, laundry hosts, `*.ops.bldg.chat` | as observed | No change |

### Env vars

Production values were not read.

| Variable | Current default in code | Proposed |
| --- | --- | --- |
| `ADMIN_BASE_URL` | `https://admin.bldg.chat` | No change. Claire and Connect callbacks stay here |
| `DAYFORGE_BILLING_APP_URL` | unset in code, fallback `https://admin.bldg.chat` | No change. Stripe success, cancel, and portal stay on that origin |
| `JOYSTICK_ALLOWED_ORIGINS` | empty default; exact origins are now in code. Commented template in `.env.example` | Do not set `https://*.gojoystick.com`. Leave unset unless a specific extra origin is required |
| `PUBLIC_APP_ORIGIN` | fallback `https://app.bldg.chat` | No change |
| `RESIDENT_API_URL` | fallback `https://api.bldg.chat` | No change |
| `VITE_RESIDENT_WEB_ORIGIN` | fallback `https://laundrybutler.bldg.chat` | No change |
| `JOYSTICK_DRIVER_PUBLIC_ACCESS` | off unless `"1"` | No change. Do not enable it for `driver.gojoystick.com` |
| `JAWBREAKER_GMAIL_REDIRECT_URI` | fallback `https://admin.gojoystick.com/api/integrations/jawbreaker/gmail/callback` | Unset in Railway; the fallback applies |
| `GOOGLE_CALENDAR_REDIRECT_URI` | fallback `https://driver.bldg.chat/` | No change |
| Stripe secret, webhook secret, price, product | not modified | No new product, price, account, or charge |

## UNKNOWN items that can break a new primary domain

1. Vercel ownership of `gojoystick.com` and `www.gojoystick.com` is **VERIFIED** as `bldg-admin-api` (`prj_8i7YrMmWXB7wWSZhbouHAKWMJFpV`). The earlier 403 was the team-scoped GET. Attaching `app.gojoystick.com`, `admin.gojoystick.com`, or `driver.gojoystick.com` to a different project would still serve the wrong app. Those three names are absent from this project.
2. OAuth provider redirect URIs were not listed. Password and membership login use same-origin `/api`. OAuth login on a new host stays broken until those URIs are registered.
3. Calendar and Gmail redirects stay on the legacy hosts. Those flows on the new hosts will not match the provider console.
4. Stripe return URLs stay on `admin.bldg.chat` until `DAYFORGE_BILLING_APP_URL` is deliberately changed. That change is not part of making the new host primary.
5. Host-only cookies mean an `admin.bldg.chat` session does not appear on `admin.gojoystick.com`. People must sign in again. That is the cookie boundary, not a shared parent domain.
6. `driver.bldg.chat` is on the Railway custom-domain list and on Vercel DNS at the same time. Adding or removing either binding without reading both consoles can take the live driver host off the app that DNS actually uses.
7. `api.gojoystick.com` attached to Vercel, or to `bldg-resident`, would not be the main API. The SPA refusal is only a backstop.
8. `ADMIN_BASE_URL`, billing URL, and Twilio console voice URLs were not read from production. If production overrides the default, this audit did not see that override. The code default remains `https://admin.bldg.chat`.
9. Email and SMS links that hardcode `admin.bldg.chat`, `driver.bldg.chat`, `app.bldg.chat`, or `api.bldg.chat` keep doing so. A new primary host will not appear in those messages until a later, separate edit.
10. Cloudflare was not confirmed absent for every zone. The sampled responses were Vercel or Railway.

## How this pass was verified

`pnpm exec vitest run` on:

- `shared/joystickHostRouting.test.ts`
- `client/src/hostRouting/joystickHostRender.test.ts`
- `client/src/lib/apiBase.test.ts`
- `server/_core/corsConfig.test.ts`
- `server/platform/tenancy/tenantIdentity.test.ts`
- `server/auth.logout.test.ts`
- `server/legacy/dayforge/security/legacyDayforgeSecurity.test.ts`
- `server/goldlineOnboarding/demoAccess.test.ts`
- `client/src/pages/driver/goldlineDriverRestoration.test.ts`
- `shared/productIdentity.test.ts`
- `server/saas/saasContract.test.ts`
- `client/src/pages/adminLiveModel.test.ts`
- `server/claire/voice/conversationRelayTransport.test.ts`

`node scripts/check-nomenclature.mjs` passed. No browser pass against production hosts with this branch, because the branch is not deployed. No mobile screenshot was regenerated.

## Rollback for this pass

Close the pull request. Nothing was attached or changed in Vercel, Railway, DNS, TLS, or production env.

The ordered human cutover, and the ordered rollback that removes only the new names and redeploys code without a database change, is `docs/launch/JOYSTICK_DOMAIN_CUTOVER.md`. Production cutover is not complete.
