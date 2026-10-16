<!-- LEGACY DAYFORGE COMPATIBILITY: retained historical environment literals below are compatibility identifiers only. Canonical product is JOYSTICK. Today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. -->

# JOYSTICK domain cutover and rollback

This procedure is for a later human operator. This pull request does not attach domains, change DNS, change production env, change Twilio, or deploy. Production cutover is not complete.

Code on this branch can ship before any new hostname exists. Legacy hosts keep working because the new names are additive.

Verified bindings used below are from `docs/launch/JOYSTICK_DOMAIN_MIGRATION_AUDIT.md`. Do not invent DNS targets. Read the target the console shows at attach time.

## Ordered cutover

1. Deploy this branch's code to the existing Vercel project `bldg-admin-api` (`prj_8i7YrMmWXB7wWSZhbouHAKWMJFpV`) and the existing Railway service `bldg-admin-api` (`9d63863a-2626-47a0-bd65-c3ba8db54258`). Do not create a second project, service, or database. Do not run a migration.
2. Confirm the already-live hosts before adding names: `gojoystick.com` still serves the marketing shell, `www.gojoystick.com` still returns 308 to the apex and keeps the path and query, `laundrybutler.bldg.chat` and `laundryfarm.bldg.chat` still serve their own sites, `admin.bldg.chat` still reaches the admin shell, `driver.bldg.chat` still reaches Day Line, and `api.bldg.chat` still reaches Railway service `bldg-resident`.
3. On that Vercel project only, attach `app.gojoystick.com`, `admin.gojoystick.com`, and `driver.gojoystick.com`. No redirect on those three. Do not attach `api.gojoystick.com` to Vercel. Do not remove `gojoystick.com`, `www.gojoystick.com`, `admin.bldg.chat`, `driver.bldg.chat`, `laundrybutler.bldg.chat`, or `laundryfarm.bldg.chat`.
4. Copy the DNS records Vercel displays for those three names. Create only those records. Apex and `www` already point at Vercel; leave them.
5. On Railway service `bldg-admin-api` only, add custom domain `api.gojoystick.com`. Copy the DNS target Railway displays. Do not point it at `scd5gg2z.up.railway.app` or at service `bldg-resident`. Do not add `api.gojoystick.com` to `bldg-resident`. Do not remove `admin.bldg.chat`, `driver.bldg.chat`, or `api.bldg.chat`.
6. Wait until the platforms report certificates for the new names. Do not buy a separate certificate.
7. Check each new host:
   - `app.gojoystick.com` shows the customer app and refuses `/admin` and `/home`.
   - `admin.gojoystick.com` shows the admin shell.
   - `driver.gojoystick.com` shows Day Line. `/` stays the driver surface. It does not enable public-driver access.
   - `api.gojoystick.com` answers the main API, not the resident API. A request there is not served by `api.bldg.chat`.
   - Laundry hosts still do not show the JOYSTICK marketing page, admin shell, or driver shell.
8. Sign-in checks, without changing provider consoles until this step: password and membership login use same-origin `/api`. OAuth on a new origin uses `https://<that-origin>/api/oauth/callback` (`client/src/const.ts`). Register that exact callback in the OAuth provider console before expecting OAuth login on that origin. Do not register a wildcard. Gmail and Calendar redirects stay on `admin.bldg.chat` and `driver.bldg.chat` until a separate console change.
9. Leave production env as it is. `ADMIN_BASE_URL` stays `https://admin.bldg.chat`. The legacy billing app URL stays on that origin. `JOYSTICK_ALLOWED_ORIGINS` stays unset. `JOYSTICK_DRIVER_PUBLIC_ACCESS` stays unset. `VITE_API_URL` stays unset. `RESIDENT_API_URL` stays `https://api.bldg.chat`. `VITE_RESIDENT_WEB_ORIGIN` stays `https://laundrybutler.bldg.chat`. `CLAIRE_TWILIO_RELAY_PUBLIC_BASE_URL` stays unset. The commented template is `.env.example`. Do not change Twilio voice URLs.

## Ordered rollback

No database change. No migration runs in either direction.

1. Delete the DNS records created in cutover steps 4 and 5 for `app.gojoystick.com`, `admin.gojoystick.com`, `driver.gojoystick.com`, and `api.gojoystick.com` only. Leave `gojoystick.com`, `www.gojoystick.com`, and every `bldg.chat` record.
2. Remove those four names from the consoles: the three app hosts from Vercel project `prj_8i7YrMmWXB7wWSZhbouHAKWMJFpV`, and `api.gojoystick.com` from Railway service `bldg-admin-api`. Do not remove the domains that were already on those projects.
3. Leave env vars unchanged. They were not part of the cutover.
4. If the deployed code must also return to the previous router, redeploy the previous application revision. That restore is a code deploy only. Session cookies are host-only, so cookies already set on `admin.bldg.chat` and `driver.bldg.chat` remain on those hosts.
5. Repeat cutover step 2. Laundry sites, apex marketing, the `www` 308, and the resident API must match the pre-cutover behavior.

Closing this pull request before any of the steps above is the rollback for the code change alone.
