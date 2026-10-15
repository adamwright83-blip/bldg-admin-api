# JOYSTICK launch execution

Operational ledger. Integration branch: `cursor/joystick-launch-integration-50a9`. Draft PR: https://github.com/adamwright83-blip/bldg-admin-api/pull/590. Base: `origin/main` `0fbc857e`. Do not merge to `main` without a separate approval.

| Track | Branch | State | Evidence | Next |
|---|---|---|---|---|
| D Day Line action | `cursor/lantern-dayline-honest-action-50a9` `66281f12` | integrated | card schedules the existing draft; objective stays incomplete; schedule is not a send | browser pass on the card |
| A Android handoff | `cursor/android-sms-compose-handoff-50a9` `cc44de54` | integrated | 52 sender/handoff tests reported; Android prefill not claimed; outbox not dispatched; `BLOCKED` | migration `0134` column check added on the integration branch; not applied to production |
| B CleanCloud freshness | `cursor/cleancloud-freshness-diagnostic-50a9` `b888e4f4` | integrated | 20 unit tests passed; no production customer read | none for this slice |
| I Landing / domain | `cursor/landing-domain-checklist-50a9` `0d24bf33` | integrated | hero unchanged; $49 trial and card-at-signup disclosed; public charge closed; `gojoystick.com` not claimed live | Stripe, onboarding, backup, and AI Gateway still separate |
| K2 AI Gateway | `cursor/cloudflare-ai-gateway-flag-50a9` `7f702358` | integrated, unused | flag default off; 9 tests passed; not wired into Claire, President, or speech | production traffic unchanged until a separate approval |
| H Backup | `cursor/backup-restore-readiness-50a9` `a8efa10a` | integrated, not on main | drill refuses production; this branch's daily retention cannot delete; `main` cron is still unguarded | founder must enable a Railway daily volume backup and must not restore over production |
| G Onboarding | `cursor/onboarding-first-value-50a9` `7c3d90d1` | integrated | unconnected preview labeled illustrative; first action is operator-reported; second tenant cannot read the session | focused tests 10 passed |
| F Stripe | `cursor/stripe-trial-checkout-50a9` `e9f340af` | integrated, checkout closed | monthly 4900 usd month and trial 7 required; annual if set must be 46800 usd year; no account id stored; 19 focused tests passed | founder must create the JOYSTICK Stripe prices and set the allowlisted account id before checkout can open |
| E Lost Property | `cursor/lost-property-durable-unlock-50a9` `0a6f25ea` | integrated, not on main | insert-once chapters 1–3; stored chapter 1 stays open if a later sale is withheld; chapter 4 cannot be stored; SMS does not open a chapter; 37 tests passed with `DATABASE_URL` unset | migration `0135` is additive and not applied to production |
| C Claire action | `cursor/claire-source-backed-action-50a9` `fb45316f` | integrated, not on main | fixture answer keeps the receipt and refuses a scripted `$999`; a withheld book is not spoken as zero; the proposal stays pending until explicit approval writes one open Day Line item; the other tenant cannot read it; 39 tests passed | operator screen not exercised; dossier and ranking reads were stubbed |

Blockers that are not engineering stops: no named production customer read, no SMS send, no Stripe live charge, no domain purchase, no production migration. Do not merge this branch to `main`.
