# JOYSTICK's first ten minutes: the build

**This document constrains future first-ten-minutes work. Current production/main outranks prose.**

Astra's proposal (parts 1 to 3), built as written, in the presentation Adam asked for on 2026-10-29. Where Astra was
specific, the code follows her words; where she was silent, the decision is recorded here. `FIRST_TEN_MINUTES.md`
(2026-10-25) describes today's funnel; where the two differ, this build follows Astra.

## Presentation rules (binding)

- **The person's own life is the spectacle.** Their words, people, routes and requests are the largest and most
  beautiful things on screen, on tactile stationery. The most emotionally significant thing on screen is theirs.
- **The crew interrupts; it is never introduced.** Characters are small, stay at the edges, and get one short line
  each, with comic timing.
- **No landing-page grammar:** no marketing headline, comparison cards, CTA-dominated layout, cast directory, step
  counter, characters posing around copy, or captions explaining the magic.
- Sable: magenta masked fox or raccoon, yellow jacket, notebook. Mara: orange fox, blue work jacket and beanie, map.
  Rook: green bird, red white-spotted mushroom beak, camo bucket hat, goggles, wind-up key, satchel, envelopes.

## Turning it on

One flag, `JOYSTICK_FIRST_TEN_MINUTES` on the Railway `bldg-admin-api` service:

| Value | Effect |
|---|---|
| unset (default) or anything else | Off. `/joystick-start` is today's funnel, as before (after one availability check); every `system.firstTenMinutes.*` procedure but `availability` refuses; the OAuth callbacks send visitors to `/joystick-start`. Nothing stored is deleted. |
| `preview` | Only a browser that opened `/joystick-start?crew=1` sees it (remembered for that tab, and for a draft started there). For trying it in production while Google lists the app in Testing mode. |
| `on` | Everyone who opens `/joystick-start` sees it. |

A Stripe return for a draft that belongs to today's funnel always lands on today's page, whatever the flag says.

## What Adam sets (nothing here is set by an agent)

### Railway → `bldg-admin-api` → production → Variables

| Variable | Value |
|---|---|
| `JOYSTICK_FIRST_TEN_MINUTES` | `preview` to try it (`/joystick-start?crew=1`), `on` to launch |
| `JOYSTICK_GOOGLE_CLIENT_ID` | from the Google OAuth client below |
| `JOYSTICK_GOOGLE_CLIENT_SECRET` | from the Google OAuth client below |
| `JOYSTICK_SLACK_CLIENT_ID` | from the Slack app below (optional: without it, "Add Slack" is disabled) |
| `JOYSTICK_SLACK_CLIENT_SECRET` | from the Slack app below |
| `JOYSTICK_CONNECTION_TOKEN_KEY` | a new random secret (`openssl rand -base64 48`). Encrypts stored Google/Slack tokens. If unset, `JWT_SECRET` is used; set it once and never change it, or stored connections stop decrypting. |
| `JOYSTICK_FIRST_TEN_ORIGINS` | optional: extra `https://` origins allowed to start a connection (comma-separated) |

`JWT_SECRET` (signs the connection state) must already be set.

### Google Cloud console (the project that owns JOYSTICK's OAuth)

1. **APIs & Services → Library**: enable **Gmail API**, **Google Calendar API**, **Google Drive API**.
2. **Google Auth Platform → Branding**: app name JOYSTICK, support email, app home page `https://gojoystick.com`,
   privacy policy and terms URLs, authorised domains `gojoystick.com` and `bldg.chat`.
3. **Audience**: External, **Testing**. Add each test user (up to 100): Adam's Google account and the pilot owners.
   Test users see Google's "unverified app" screen; everyone else is blocked until verification.
4. **Data Access → Add or remove scopes**: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`,
   `.../auth/gmail.readonly`, `.../auth/calendar.readonly`, `.../auth/drive.readonly`. Nothing else.
5. **Clients → Create client → Web application** ("JOYSTICK first ten minutes"). Authorised redirect URIs:
   - `https://gojoystick.com/api/first-ten/oauth/google/callback`
   - `https://admin.bldg.chat/api/first-ten/oauth/google/callback`
   - `https://admin.gojoystick.com/api/first-ten/oauth/google/callback`
   - `https://app.gojoystick.com/api/first-ten/oauth/google/callback`

   Copy the client ID and secret into Railway.
6. **Before a public launch**: Verification Center → submit. Gmail and Drive read access are *restricted* scopes:
   Google requires a privacy policy that covers Google user data and its Limited Use, a demo video of the consent
   flow, and a CASA (Tier 2) security assessment by an approved assessor, renewed yearly.

### Slack (api.slack.com/apps)

1. **Create New App → From scratch**, name JOYSTICK.
2. **OAuth & Permissions → Redirect URLs**: the same four origins with `/api/first-ten/oauth/slack/callback`.
3. **User Token Scopes** (no bot scopes): `channels:read`, `channels:history`, `groups:read`, `groups:history`,
   `im:read`, `im:history`, `mpim:read`, `mpim:history`, `users:read`, `search:read`.
4. **Manage Distribution → Activate Public Distribution**, so owners outside Adam's workspace can add it.
5. **Basic Information → App Credentials**: client ID and secret into Railway.

## How it is built

| Piece | Where |
|---|---|
| Contracts (flag, scopes, "what connecting includes", journey shape) | `shared/firstTenMinutes.ts` |
| Nina's labelled example | `shared/firstTenMinutesExample.ts` |
| Server | `server/firstTenMinutes/` (`router.ts` is `system.firstTenMinutes`, `oauthRoutes.ts` the callbacks) |
| Tables | `drizzle/0152_first_ten_journeys.sql` (journeys, connections), applied by `scripts/migrate.mjs` |
| Page | `client/src/pages/firstTenMinutes/`, mounted at `/joystick-start` by `JoystickStartRoute.tsx` |
| End to end | `scripts/first-ten-e2e.sh`, `e2e/first-ten-minutes/`, CI workflow `first-ten-minutes.yml` |

**Journeys.** Each visit is a signup draft (the legacy `dayforge_saas_onboarding_sessions` table, mode `joystick_first_ten`, 14-day
expiry) with one journey. Its resume token stays in the starting origin's browser storage under its own key, so it
never mixes with today's funnel. Google, Slack and Stripe all return to that origin.

**Connections.** Read-only Google (Gmail, Calendar, Drive) and Slack (user token). The consent URL comes from a
mutation that records the start origin and sets a ten-minute HttpOnly nonce cookie; the callback requires the signed
state, the same browser's nonce, and a known origin, then stores the tokens encrypted (AES-256-GCM). Google without
Gmail is revoked and refused, plainly. Disconnecting revokes at the provider (best effort) and deletes the copy either
way. The callback never echoes a code, token or provider message.

**The example.** "Explore an example" is Nina's flower studio, invented, on the reserved `.example` domain, labelled
on every screen ("Example: Nina's flower studio, invented. Nothing here is yours.") with "Bring your own" one tap
away. It cannot connect accounts, and (later slices) cannot activate or send.

## Slices

| # | Slice | State |
|---|---|---|
| 1 | Connect: Google and Slack OAuth, what connecting includes, the labelled example | this PR |
| 2 | Understanding: the job that reads the sources into sourced findings, progress that tracks the work | next |
| 3 | The crew gets acquainted: seven reveals, sources on tap, corrections, Sable's confirm changes the world | |
| 4 | Claire's portrait: "That sounds like me / Let me change something" | |
| 5 | The revelation and "A Proper Letter" in the Silver Lake courtyard, handing off to the real draft | |
| 6 | Activation at the moment of value: the draft, scene and decision survive checkout | |
| 7 | "Your first chapter": Claire answers "Where did we leave things with Elena?" with the real state | |
| 8 | Part 3: "The Friday That Didn't Exist", "The Estimate That Wouldn't Fit", "Here is what changed because you arrived" | |

## Verification

- `pnpm exec vitest run server/firstTenMinutes shared/firstTenMinutes`
- On a local disposable MySQL (`first_ten_test`): `node scripts/migrate.mjs` twice, then
  `pnpm exec vitest run --config vitest.integration.config.ts server/firstTenMinutes`
- `scripts/first-ten-e2e.sh`: the real server and page, Google and Slack played locally. Screenshots land in
  `tmp/first-ten-e2e-shots/`.

Not verifiable here: real Google and Slack consent screens and tokens (they need the production clients above), and
anything on production Railway.
