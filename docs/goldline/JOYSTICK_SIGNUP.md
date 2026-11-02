# JOYSTICK sign-up and log-in (Google)

`gojoystick.com/signup` and `/login`: one "Continue with Google", modelled on Town's sign-up. The flow is staged:
- **Signing in** asks Google only for name, email and profile. Google lets anyone grant those with no warning, even
  while the app's restricted scopes await verification.
- **The next screen** (the first ten minutes, "Bring your world") asks for read-only Gmail, Calendar and Drive, with
  the signed-in address as Google's `login_hint`. Declining keeps the account.

## Pieces
- **Account** (`server/joystickAccount`, drizzle 0165): `joystick_accounts`, one per Google account (`google_sub`), plus
  `joystick_account_journeys`.
  - An account is not a `users` row. A users row is a workspace identity and defaults to tenant `default`.
  - Its own cookie, `joystick_account` (HMAC-signed, httpOnly, host-only, 30 days), reaches nothing but the person's
    own first-ten journeys.
- **Journey token**: `acct_<account>_<version>_<mac over the draft id>`.
  - It is handed to `/joystick-start` in the existing `#first-ten=` fragment. `requireOnboardingSession`
    (`server/saas/saasStore.ts`) accepts it for drafts the account owns.
  - The same journey therefore opens on every device the person signs in on.
- **Sign-out** (`system.account.signOut`) raises `session_version`. Every account cookie and journey token issued
  before it stops working, on every device, and this browser's workspace session is cleared too. A workspace session
  (`app_session_id`) open on another device ends only there, because it isn't stored server-side.
- **After activation**, "Continue with Google" opens the workspace. It issues the owner's workspace session with the
  same checks as the password sign-in: an active owner membership, workspace status and paid entitlement
  (`workspace.ts`). The password stays as a second way in.
- **Funnel** (counts, no content): `signed_up_at`, `google_connected_at`, `first_lines_at`, `portrait_kept_at`,
  `activated_at`. Use these to compare staged against one-step consent: the share of sign-ups who reach the first
  lines, not the number of accounts.

## Who can sign up
Sign-up follows `JOYSTICK_FIRST_TEN_MINUTES`:

| mode | who can sign up |
|---|---|
| `on` | anyone |
| `preview` | a browser holding the crew link's preview pass (`/signup?crew=<code>` works too) |
| `off` | nobody |

- In `preview`, only the crew link admits. A new account needs the pass.
- An account admitted under the current crew code records it (`preview_version`), and its cookie then counts as a pass
  on any device. A new crew code, or none, closes those accounts too, just as it revokes every pass.
- An account cookie never admits a different Google identity.
- A first sign-up adopts the journey this browser already began through the crew link (and its Google connection),
  instead of orphaning it.

## Pages
- `client/src/pages/account/SignInPage.tsx`: the split layout, three true trust tiles, and "JOYSTICK and your data".
- `client/public/joystick-home/privacy.html` and `terms.html`, served at `/privacy` and `/terms` (`vercel.json`). Every
  statement in them matches the code. They need the company's legal name, a contact email and the governing state
  before they go live. They are not legal advice; have them reviewed.

## Google Cloud (Claude Duet; each step approved by Adam)
1. **Authorized redirect URIs** on the onboarding OAuth client:
   - `https://gojoystick.com/api/account/google/callback`
   - `https://gojoystick.com/api/first-ten/oauth/google/callback`
   - and the same two for `app.gojoystick.com` and `admin.gojoystick.com`.
2. **Branding:**
   - app name "JOYSTICK";
   - home page `https://gojoystick.com`;
   - privacy `https://gojoystick.com/privacy`;
   - terms `https://gojoystick.com/terms`;
   - support email;
   - authorized domain `gojoystick.com`, verified in Search Console.
3. **Publish to production.** Sign-in then works for anyone; it already works for anyone in Testing, because it asks
   only for basic scopes.
4. **Submit verification** for gmail.readonly, drive.readonly, calendar.readonly (and gmail.send), including the CASA
   security assessment.
   - Until it passes, the Gmail step shows Google's unverified-app screen and is capped at 100 new users.
   - Once verified, a one-step consent (like Town's) can be tried against staged.

## Tests
- **Unit:** `server/joystickAccount/joystickAccount.test.ts` covers the cookie, journey token, preview gate, rate
  limit and callback.
- **MySQL:** `accounts.mysql.integration.test.ts` covers create and find, cross-device open, sign-out revocation and
  funnel steps.
- **Browser:** `e2e/first-ten-minutes/signup.spec.ts` covers sign-up into the connect step, log-in elsewhere to the
  same journey, sign-out everywhere, and the legal pages.
