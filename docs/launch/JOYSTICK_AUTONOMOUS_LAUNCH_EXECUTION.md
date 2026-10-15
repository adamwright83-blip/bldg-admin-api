# JOYSTICK launch execution

Operational ledger. Integration branch: `cursor/joystick-launch-integration-50a9`. Draft PR: https://github.com/adamwright83-blip/bldg-admin-api/pull/590. Base: `origin/main` `0fbc857e`. Do not merge to `main` without a separate approval.

| Track | Branch | State | Evidence | Next |
|---|---|---|---|---|
| D Day Line action | `cursor/lantern-dayline-honest-action-50a9` `66281f12` | integrated | card schedules the existing draft; objective stays incomplete; schedule is not a send | browser pass on the card |
| A Android handoff | `cursor/android-sms-compose-handoff-50a9` `cc44de54` | integrated | 52 sender/handoff tests reported; Android prefill not claimed; outbox not dispatched; `BLOCKED` | migration `0134` column check added on the integration branch; not applied to production |
| B CleanCloud freshness | `cursor/cleancloud-freshness-diagnostic-50a9` `b888e4f4` | integrated | 20 unit tests passed; no production customer read | none for this slice |
| I Landing / domain | `cursor/landing-domain-checklist-50a9` `0d24bf33` | integrated | hero unchanged; $49 trial and card-at-signup disclosed; public charge closed; `gojoystick.com` not claimed live | Stripe, onboarding, backup, and AI Gateway still separate |
| F, G, H, K2 | starting | owners assigned | — | not integrated yet |

Blockers that are not engineering stops: no named production customer read, no SMS send, no Stripe live charge, no domain purchase, no production migration.
