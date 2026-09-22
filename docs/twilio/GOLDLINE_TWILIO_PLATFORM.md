# Goldline Twilio platform

Twilio is the pipe and the source of provider receipts. Goldline remains the brain, the business authority, the scheduler, the lock, the source of truth, and the Narrator boundary.

Slice 1 adds a shared client, a capability registry, and one communications receipt log. It does not replace Claire's production voice.

## Architecture

```text
Twilio Console / webhooks
        │
        ▼
server/claire/claireTwilio.ts          production Gather voice (unchanged host)
server/claire/conversation/twilioSignature.ts
        │
        ▼
server/twilioPlatform/                 Slice 1 seam for new code
  client.ts                            one Twilio REST client
  config.ts                            existing env vars, no credential export
  capabilities.ts                      state registry
  communicationReceipts.ts             one receipt table, idempotent
  communicationEvidence.ts             provider facts → communications evidence
        │
        ▼
Goldline                               business authority, scheduler, lock,
                                       source of truth, Narrator boundary
```

New platform code calls `getTwilioPlatformClient()`. It does not construct a second SDK style, and it does not read the auth token back out of a public config object.

Production Claire calling keeps the client it already creates in `server/claire/claireTwilio.ts`. Slice 1 does not retarget that client.

## Existing Claire voice baseline

Inbound Claire calling is the production voice path. This slice does not treat it as broken, does not change webhook URLs, and does not redesign inbound identity.

`server/claire/claireTwilio.ts` remains the voice implementation:

- Gather is the production default. Conversation Relay is flag-off.
- xAI TTS stays the speech transport, with Polly as the existing fail-open.
- The conversation ledger and speech-delivery accounting stay where they are. A generated line is not confirmed-heard speech.
- Inbound identity is `authorizedInboundOperator` / `resolveClaireOperatorIdForPhone`. Unknown numbers fail closed. There is no second allowlist.
- Webhook signatures stay on `isValidTwilioWebhook` in `server/claire/conversation/twilioSignature.ts`. Invalid signatures are rejected. This slice does not weaken that check.
- Recording stays behind `CLAIRE_VOICE_RECORDING_ENABLED`.

Existing voice routes, left on their current host:

| Route | Role |
|---|---|
| `POST /api/claire/twilio/inbound` | Inbound answer |
| `POST /api/claire/twilio/pre-drive` | Gather continuation |
| `POST /api/claire/twilio/call-status` | Call status callback |
| `POST /api/claire/twilio/recording-status` | Recording callback |
| `POST /api/claire/twilio/debrief` | Field debrief |
| `POST /api/claire/twilio/confirm` | Confirmation gather |

Outbound Claire calls remain the existing authorized-operator path: one explicit call for a persisted operator of the same tenant. This slice does not add a repeated or autonomous dialer.

## What Slice 1 adds

- `shared/twilioPlatform.ts` — receipt vocabulary, evidence concepts, capability ids, idempotency key.
- `server/twilioPlatform/client.ts` — lazy singleton around the official Twilio SDK.
- `server/twilioPlatform/config.ts` — one reading of the production env vars.
- `server/twilioPlatform/capabilities.ts` — registry of states, not booleans.
- `server/twilioPlatform/communicationReceipts.ts` — write path for provider receipts.
- `server/twilioPlatform/communicationEvidence.ts` — pure map onto communications evidence.
- `communication_receipts` — one table (`drizzle/0094_communication_receipts.sql`, applied from `scripts/migrate.mjs`).

There is no `twilio_calls`, `twilio_sms`, or other Twilio product table.

## Truth boundaries

A Twilio callback proves something about the pipe: a call was attempted, rang, connected, completed, was busy, failed, went to voicemail, or a message was sent, delivered, or failed.

It does not prove:

- `CUSTOMER_INTERESTED`
- `CUSTOMER_APPROVED` or property approval
- sales follow-up success
- `MISSION_COMPLETED`
- `SALE_WON`
- `PROMISE_KEPT`
- WeeklyIntent fulfilled
- Daily Command completed
- a Narrator event

Provider SIDs (`CallSid`, `MessageSid`, parent call SID, provider event id) are not Goldline entity ids. They are not mission ids, order ids, intent ids, or narrator ids.

Goldline business outcomes still have to come from Goldline's own authority. The Narrator still has its own occurrence boundary. A receipt must not be written into those logs as if the business event happened.

## Evidence rules

`toCommunicationCandidateEvidence` maps a `TwilioCommunicationReceipt` to zero or more `CommunicationCandidateEvidence` values.

| Receipt event | Evidence concepts |
|---|---|
| `CALL_ATTEMPTED` | `CALL_ATTEMPTED` |
| `CALL_RINGING` | `CALL_RINGING` |
| `CALL_CONNECTED` | `CALL_CONNECTED`, plus `CALL_DURATION_OBSERVED` when a duration is present |
| `CALL_COMPLETED` | `CALL_COMPLETED`, plus `CALL_DURATION_OBSERVED` when a duration is present |
| `CALL_NO_ANSWER` | `CALL_NO_ANSWER` |
| `CALL_BUSY` | `CALL_BUSY` |
| `CALL_FAILED` | `CALL_FAILED` |
| `VOICEMAIL_DETECTED` | `VOICEMAIL_DETECTED` |
| `MESSAGE_SENT` | `MESSAGE_SENT` |
| `MESSAGE_DELIVERED` | `MESSAGE_DELIVERED` |
| `MESSAGE_FAILED` | none — receipt only |

`CALL_CONNECTED` for 224 seconds is a connected call with an observed duration. It is not customer interest, approval, a sale, a completed mission, a fulfilled WeeklyIntent, a completed Daily Command, or a Narrator event.

`communicationEvidenceImpliesBusinessOutcome` is false for every evidence item.

## Idempotency

Twilio retries the same callback. The receipt write must return the original row.

1. When Twilio supplies a provider event id, the key is `twilio:event:{tenantId}:{providerEventId}`.
2. Otherwise the key is `twilio:class:{tenantId}:{CallSid|MessageSid}:{event class}`.
3. Keys longer than the column are stored as a stable `twilio:hash:` digest of that same identity.

Uniqueness is enforced in the store and by `uq_communication_receipts_idempotency` plus `uq_communication_receipts_provider_event`. A duplicate insert returns the first row with `duplicate: true`.

## Capability registry

States: `UNCONFIGURED`, `DISABLED`, `CONFIGURED`, `CONFIGURED_FAILING`, `LIVE`.

`assertTwilioCapability` throws `TwilioCapabilityUnavailableError` for anything other than `CONFIGURED` or `LIVE`. The error carries the capability, the state, and the reason. Unconfigured and feature-disabled capabilities fail explicitly.

`LIVE` means the existing production env for that pipe is present. It is not a live probe of Twilio, and it is not used for products that are only flagged or only have a SID.

| Capability | LIVE | Otherwise |
|---|---|---|
| `voiceGather` | Account SID, auth token, `CLAIRE_TWILIO_FROM_NUMBER`, and `CLAIRE_OPERATOR_PHONE` or `CLAIRE_OPERATOR_PHONES` | `UNCONFIGURED` with the missing piece |
| `sms` | Those credentials plus `TWILIO_FROM_NUMBER` or `TWILIO_PHONE_NUMBER` | `UNCONFIGURED`. The Claire voice number is not assumed to be the SMS sender |
| `conversationRelay` | never, in this slice | `DISABLED` / `feature_flag_off` unless `CLAIRE_TWILIO_CONVERSATION_RELAY=true`, then `CONFIGURED` when the account exists |
| `answeringMachineDetection` | never, in this slice | `DISABLED` / `feature_flag_off` unless `CLAIRE_TWILIO_AMD=true`, then `CONFIGURED` when Gather's env is present |
| `proxy` | never | `UNCONFIGURED` / `missing_service_sid` until `TWILIO_PROXY_SERVICE_SID` is set, then `CONFIGURED` |
| `verify` | never | `missing_service_sid` until `TWILIO_VERIFY_SERVICE_SID` |
| `conversations` | never | `missing_service_sid` until `TWILIO_CONVERSATIONS_SERVICE_SID` |
| `sync` | never | `missing_service_sid` until `TWILIO_SYNC_SERVICE_SID` |
| `conversationIntelligence` | never | `missing_service_sid` until `TWILIO_INTELLIGENCE_SERVICE_SID` |
| `taskRouter` | never | `missing_workspace_sid` until `TWILIO_TASKROUTER_WORKSPACE_SID` |
| `brandedCalling` | never | `missing_customer_profile_sid` until `TWILIO_BRANDED_CALLING_CUSTOMER_PROFILE_SID` |
| `studioFallback` | never | `DISABLED` / `feature_flag_off` unless `CLAIRE_TWILIO_STUDIO_FALLBACK=true`; then `missing_flow_sid` until `TWILIO_STUDIO_FLOW_SID` |
| `lookup` | never | `UNCONFIGURED` / `not_provisioned` unless `TWILIO_LOOKUP_ENABLED=true` |
| `transcription` | never | `not_provisioned` unless `TWILIO_TRANSCRIPTION_ENABLED=true` |
| `whatsapp` | never | `missing_from_number` until `TWILIO_WHATSAPP_FROM` |
| `conference` | never | `DISABLED` / `feature_flag_off` unless `CLAIRE_TWILIO_CONFERENCE=true` |

A noted provider failure moves `LIVE` or `CONFIGURED` to `CONFIGURED_FAILING`. It does not invent a success.

## Env vars and feature flags

Reused production variables:

| Variable | Use |
|---|---|
| `TWILIO_ACCOUNT_SID` | REST account. Never log it as a substitute for the auth token, and never print the token |
| `TWILIO_AUTH_TOKEN` | Signature validation and the REST client. Not part of public config |
| `CLAIRE_TWILIO_FROM_NUMBER` | Claire voice caller id |
| `CLAIRE_OPERATOR_PHONE` | Single operator phone, bound to `OWNER_OPEN_ID` |
| `CLAIRE_OPERATOR_PHONES` | JSON map of operator id to phone |
| `TWILIO_FROM_NUMBER` or `TWILIO_PHONE_NUMBER` | Existing SMS sender in `server/_core/sms.ts` |
| `CLAIRE_VOICE_RECORDING_ENABLED` | Existing recording consent gate. Off unless exactly enabled |
| `CLAIRE_XAI_TTS_ENABLED` | Existing speech transport. Not a Twilio capability |

Slice 1 flags and product SIDs. A flag is on only when the value is `true`. None of these values belong in the repo:

| Variable | Effect when unset |
|---|---|
| `CLAIRE_TWILIO_CONVERSATION_RELAY` | Conversation Relay `DISABLED` |
| `CLAIRE_TWILIO_AMD` | Answering-machine detection `DISABLED` |
| `CLAIRE_TWILIO_STUDIO_FALLBACK` | Studio fallback `DISABLED` |
| `CLAIRE_TWILIO_CONFERENCE` | Conference `DISABLED` |
| `TWILIO_LOOKUP_ENABLED` | Lookup `UNCONFIGURED` |
| `TWILIO_TRANSCRIPTION_ENABLED` | Transcription `UNCONFIGURED` |
| `TWILIO_PROXY_SERVICE_SID` | Proxy `UNCONFIGURED` |
| `TWILIO_VERIFY_SERVICE_SID` | Verify `UNCONFIGURED` |
| `TWILIO_CONVERSATIONS_SERVICE_SID` | Conversations `UNCONFIGURED` |
| `TWILIO_SYNC_SERVICE_SID` | Sync `UNCONFIGURED` |
| `TWILIO_INTELLIGENCE_SERVICE_SID` | Conversation Intelligence `UNCONFIGURED` |
| `TWILIO_TASKROUTER_WORKSPACE_SID` | TaskRouter `UNCONFIGURED` |
| `TWILIO_STUDIO_FLOW_SID` | Required once Studio fallback is flagged on |
| `TWILIO_MESSAGING_SERVICE_SID` | Presence only. SMS liveness still follows the from-number |
| `TWILIO_WHATSAPP_FROM` | WhatsApp sender address |
| `TWILIO_BRANDED_CALLING_CUSTOMER_PROFILE_SID` | Branded calling profile presence |

Public config reports whether credentials are present. It does not return the auth token. Logs from this layer redact phone numbers to the last four digits.

Receipt endpoint columns follow the existing phone varchar convention (`fromNumber`, `toNumber`). They are operational addresses on the receipt, not a new identity system. Provider error text is scrubbed if it contains the auth token.

## Twilio Console checklist

Confirm these in the Console. Do not paste SIDs, tokens, or phone numbers into this repo.

1. **Claire number.** The number already used as `CLAIRE_TWILIO_FROM_NUMBER` is still the Claire voice number. Leave its voice webhook on the existing inbound URL. Do not replace that URL and do not point it at Conversation Relay or Studio.
2. **Voice webhook.** `POST` to the existing `/api/claire/twilio/inbound` host. Signature validation stays on. Status callbacks stay on the existing call-status path.
3. **SMS.** If the account sends SMS, the sender is `TWILIO_FROM_NUMBER` or `TWILIO_PHONE_NUMBER`, which may differ from the Claire voice number. Do not repoint the Claire voice webhook to make SMS work.
4. **Conversation Relay.** Leave it off. `CLAIRE_TWILIO_CONVERSATION_RELAY` stays unset. Gather remains the production default.
5. **Answering machine detection.** Do not enable AMD on the Claire inbound number. `CLAIRE_TWILIO_AMD` stays unset until a later slice attaches it only to calls that were already authorized.
6. **Lookup.** Enable the Lookup product in the Console only when Goldline is ready to call it, then set `TWILIO_LOOKUP_ENABLED=true`. Until then the capability stays unconfigured.
7. **Verify.** Create a Verify service when that product is in scope. Put its SID in `TWILIO_VERIFY_SERVICE_SID`. Do not copy the SID into docs or logs.
8. **Proxy.** Create a Proxy service when that product is in scope. Put its SID in `TWILIO_PROXY_SERVICE_SID`. No SID means `UNCONFIGURED` / `missing_service_sid`.
9. **Branded calling.** Trust Hub / branded calling stays unconfigured until a customer profile SID is set. A later slice owns the branded-calling product note.
10. **Conference.** Leave `CLAIRE_TWILIO_CONFERENCE` unset. Conference is not part of the Claire Gather call.
11. **Studio fallback.** Leave `CLAIRE_TWILIO_STUDIO_FALLBACK` unset and do not install a Studio flow in front of the Claire voice webhook. A later slice owns the Studio product note.

Studio and branded-calling product docs are not part of Slice 1. This page does not wait on them. Link those notes here when they exist.

## Receipt fields

`tenantId`, `operatorUserId`, `provider`, `providerEventId`, `eventType`, `callSid`, `parentCallSid`, `messageSid`, `direction`, `from`, `to`, `status`, `startedAt`, `answeredAt`, `completedAt`, `durationSeconds`, `providerErrorCode`, `providerErrorMessage`, `idempotencyKey`, `createdAt`.

`from` and `to` are stored as `fromNumber` and `toNumber`. `provider` is `twilio`.
