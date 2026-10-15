# gojoystick.com activation

Founder checklist. `gojoystick.com` is **not purchased**. DNS is **not live**. Nothing in this file registers a domain or changes records.

Do this only after the domain is bought and a person approves the map below. Until then, leave production on `admin.bldg.chat`.

## Do not do

- Do not point the apex at Railway.
- Do not use Flexible SSL.
- Do not attach `api` until Railway shows that service's own custom-domain target. Do not invent a CNAME.
- Do not remove `admin.bldg.chat`. Rollback is to keep using it.

## Proposed map (after purchase and approval)

| Host | Where | Condition |
| --- | --- | --- |
| `gojoystick.com` and `www.gojoystick.com` | Vercel marketing frontend | Founder approval. Apex stays off Railway. |
| `app.gojoystick.com` | Vercel | Only if routing already supports a split host. It does not today. See below. |
| `api.gojoystick.com` | Railway service `bldg-admin-api` | Only after that service shows its own custom-domain target for this name. |

## What this repo actually shows

**VERIFIED** in repo files (not a live DNS check this session):

- `vercel.json` proxies `/api/:path*` to `https://bldg-admin-api-production.up.railway.app/api/:path*`.
- `vercel.json` rewrites `/joystick` to `/index.html`. It has **no** rewrite for `/joystick-start`.
- `client/src/App.tsx` treats `admin.bldg.chat` and `api.bldg.chat` as the same admin shell. Separate hosts exist for `driver.bldg.chat`, `*.ops.bldg.chat`, and `boreslay.com` / `www.boreslay.com`. There is no `app.` host and no `gojoystick.com` host. A new apex that is not one of those hosts falls through to the public landing. That is not a marketing-versus-app split.
- Snapshot `artifacts/claire-strategy/acceptance/railway-read-only.json` (`observedAt` `2026-10-13T22:11:29.899Z`), project `supportive-creation`, service `bldg-admin-api` (`9d63863a-2626-47a0-bd65-c3ba8db54258`), environment production (`330bff45-7d21-4cdf-be04-b38cea76fcfb`):
  - Service domain: `bldg-admin-api-production.up.railway.app`
  - Custom domains on that service: `admin.bldg.chat`, `driver.bldg.chat`
  - `api.bldg.chat` is **not** in that custom-domain list

**UNKNOWN** (not observed this session):

- Whether `gojoystick.com` is registered. Treat it as not purchased.
- Live DNS for `gojoystick.com`, `admin.bldg.chat`, `api.bldg.chat`, and `driver.bldg.chat`.
- Current Vercel project id. `docs/legacy-dayforge-production-deployment.md` names Vercel project `bldg-admin-api` in org `adamwright83-2158s-projects` for `admin.bldg.chat`. That doc also says `vercel.json` has no `/api` rule, which the current file contradicts. No `.vercel/project.json` is in the repo. Do not treat the doc's project binding as a fresh read.
- The CNAME or target Railway would display for a new `api.gojoystick.com` custom domain.
- Whether `admin.bldg.chat` is still attached to Vercel, Railway, or both. The Oct 13 snapshot lists it on Railway. The older deployment doc lists it on Vercel.

## Steps once the founder owns the domain

1. Buy `gojoystick.com` in the registrar the founder chooses. Confirm the registrar screen before any DNS edit.
2. Add `gojoystick.com` and `www.gojoystick.com` on the Vercel marketing project only. Use the DNS values Vercel shows on that screen. Apex is not a Railway record.
3. Leave `app.gojoystick.com` unset until `App.tsx` has a real app-host branch and `vercel.json` allows the app routes that host must serve, including `/joystick-start`.
4. On Railway service `bldg-admin-api`, add `api.gojoystick.com` only when the service UI shows the custom-domain target. Copy that target. Do not guess `*.up.railway.app`.
5. If a proxy sits in front, SSL is Full (strict) or the platform's managed certificate. Never Flexible.
6. Check `https://gojoystick.com` shows the marketing page and does not open a live charge. `admin.bldg.chat` still opens the current app.
7. Rollback: delete only the new `gojoystick.com` records. Keep `admin.bldg.chat`.
