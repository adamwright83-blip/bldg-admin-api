# DayForge authentication behavior

## Where people land after sign-in

DayForge evaluates one safe destination after the server accepts the workspace, email, password, active tenant, and active membership. The order is:

1. A valid internal secure field-mission destination, when the login was part of a mission handoff.
2. The same Territory Preview session, when the person came from a public preview.
3. A validated internal `returnTo` path, such as `/commercial-pipeline`.
4. `/dayforge-today` for every ordinary sign-in without valid continuation context.

Owners, managers, operators, and field members use this same destination contract. Authorization still applies after landing: a field member cannot gain owner access by putting an owner route in a URL, and an inactive membership cannot log in. `/julydemo` is never an implicit destination; it remains reachable only as an explicit demo route under the existing demo protections.

## What happens to preview and onboarding context

Territory Preview keeps its server-issued session credentials in browser session storage. The URL carries only the preview session identifier, not the bearer resume token. The selected opportunity is already stored against that server preview session.

If login is required, DayForge returns to `/territory-preview?resume=<session-id>`. The preview page then uses the browser-held credential to restore the same server session and selected opportunity. If onboarding is required, the validated preview identifier and internal return path survive configuration, Stripe Checkout return, tenant provisioning, owner activation, and the final login. Stripe and analytics do not receive the preview bearer token.

Closing the browser tab, clearing session storage, using a different browser, or letting the server preview expire can remove the browser's ability to resume. DayForge does not weaken the preview token design to work around that; the person must run or resume a valid preview again.

## Invalid and excluded destinations

DayForge rejects external URLs, protocol-relative URLs, backslashes, encoded path separators, control characters, malformed encoding, oversized paths, `javascript:`/`data:` values, authentication loops, onboarding loops, and `/julydemo` as a return target. Secret-looking query and fragment fields such as `token`, `handoff`, `code`, `state`, and legacy preview bearer values are stripped from an otherwise valid internal path.

An invalid, expired, absent, or unauthorized continuation falls back safely to `/dayforge-today`. A return URL never chooses a tenant and never bypasses membership or route authorization.

## Before and after examples

- Before: Elena signs into her active owner workspace from a bookmark and is dropped into a demo controller that may say "Demo mode is off." After: she lands on `/dayforge-today` and sees her tenant's revenue action queue.
- Before: Adam selects Maybourne Beverly Hills in Territory Preview, signs in, and loses the selection. After: he returns to the same preview session and can convert that same selected opportunity into the canonical tenant mission.
- Before: a new owner finishes Stripe Checkout and owner activation, then has to reconstruct where they were. After: the validated preview/return context is carried to the final login and resolved by the same destination rules.
- Before: an attacker supplies `returnTo=https://evil.example/collect`. After: the value is rejected and the authenticated user lands on `/dayforge-today`.
- Before: a field operator follows a valid mission continuation and gets a generic home. After: the valid internal mission destination wins, while the field route still enforces tenant and assignee access.

## Rollback

The clean pre-project rollback point is `fc6d70c025086d727e3cb3fd5ecb8a9f0b369187`. The auth behavior is isolated in the auth-phase commit on `codex/dayforge-30-day-v3`; revert that commit to restore the prior frontend redirect while leaving earlier additive schema migrations safe. Do not roll back by changing the database or redirecting normal users to `/julydemo`. If continuation causes an incident, disable the auth-phase application commit and use `/dayforge-today` as the fixed safe destination while investigating.
