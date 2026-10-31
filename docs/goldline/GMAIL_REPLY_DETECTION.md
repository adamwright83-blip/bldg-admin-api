# Gmail reply detection

JOYSTICK notices when someone writes back in a conversation it started, so Claire and the business systems know.
Code: `server/integrations/gmail/replies/`. Off unless `GMAIL_REPLY_DETECTION=on`.

## What it does

1. **One watch per connected operator mailbox.** The tenant's existing Gmail connection (`jawbreaker_gmail_connections`,
   `gmail.readonly`) is watched with `users.watch` on the inbox. Watches are renewed when older than 20 hours (Google:
   at least every 7 days, daily recommended). Expiry and the Gmail `historyId` cursor are kept in `gmail_mailbox_watches`.
2. **Authenticated push.** Pub/Sub pushes to `POST /api/integrations/gmail/push`. The Google-signed OIDC token must
   verify (Google's keys), with issuer Google, audience `GMAIL_PUSH_AUDIENCE`, and the email `GMAIL_PUSH_SERVICE_ACCOUNT`
   (verified). Anything else gets 401. The notice is stored (`gmail_push_notices`, deduplicated by Pub/Sub message id)
   *before* it is acknowledged, then processed.
3. **Evidence before a record.** A notice only says a mailbox changed. `users.history.list` is read from the cursor.
   Each added message is fetched (headers and Gmail's snippet only, never the body). A message is recorded in
   `gmail_inbound_messages` only when it belongs to a tracked conversation: the same Gmail thread as, or a reply to the
   Message-ID of, a message JOYSTICK sent and Google confirmed (`gmail_sends`, status `sent`), **owned by the
   mailbox's tenant**. Nothing about any other mail is stored.
   - **Tenant ownership.** Two tenants may watch the same Gmail address; a conversation is tracked only for the tenant
     that owns it. `gmail_sends` has no tenant, so the owner comes from the sender: a first-ten send
     (`first_ten:<journey>`) belongs to the tenant its journey was provisioned into. A send with no known owner (a
     journey not provisioned yet) is tracked for nobody.
4. **What it is.** Each recorded message is a person writing back (`human_reply`), an automatic reply, or a delivery
   failure. This is decided from RFC 3834 and mail-server headers, and conservatively: when in doubt it is not a human
   reply. Bulk mail and the owner's own messages are never recorded.
5. **Recovery.**
   - The cursor moves only after every message up to it was handled, so a crash, restart or failed fetch replays history.
   - Records are idempotent, and effects that didn't finish are re-run.
   - An expired cursor (404) is recovered by reading each open tracked thread, then restarting from the current `historyId`.
   - A reconciliation pass runs every 5 minutes for dropped or delayed notices.
   - Revoked or expired Google access (Testing-mode grants end after 7 days) marks the mailbox `reconnect_required`.
     A removed connection marks it `disconnected`.
6. **Claire.** `read_customer_replies` (in `server/claire/prototype/tools.ts`) reads the tenant's verified replies.
   It also reports whether replies are being watched at all, so "nobody wrote back" is never said when JOYSTICK couldn't
   see. "Watching" means the mailbox is connected and JOYSTICK actually read it in the last 30 minutes
   (`last_processed_at`, stamped by every finished pass); connected but not read recently is `not_checked_recently`. A reply is never called a booking, a sale or a new customer.
7. **Follow-ups.** `followUpVerdict(conversation)` is the gate any automated follow-up must pass immediately before it
   sends. A person's reply or a bounce holds it; an out-of-office does not. It only ever holds a send: receiving
   evidence never authorises sending.

## Not built here (honest scope)

- **Extreme Mode does not exist yet**, so there is no standing-authorization model to plug into. The follow-up gate is
  the seam it must call. Nothing here can send.
- **Only conversations JOYSTICK sent through the Gmail send service, owned by the watching tenant, are tracked.** Today
  those are first-ten sends whose journey was provisioned into a tenant, sent from the same Gmail address that tenant
  connected as its operator mailbox. While JOYSTICK isn't taking payment, journeys aren't provisioned, so no
  conversation is eligible yet: the live test needs a provisioned journey (or a future tenant-owned send path).
- **SMS follow-ups (`scheduled_outreach_messages`, Silver Lake texting) are untouched.** An email reply is not linked to
  an SMS customer without a verified identity, so none is cancelled.
- **First-ten's own reply check** (reading the onboarding user's mail on demand) is unchanged.

## Configuration

Google Cloud, project `bldg` (`gen-lang-client-0159109182`). The topic must be in the OAuth client's project:
- topic `joystick-gmail-inbox`, with Publisher granted to `gmail-api-push@system.gserviceaccount.com`;
- push subscription `joystick-gmail-inbox-push` to `https://admin.bldg.chat/api/integrations/gmail/push`, with
  authentication via `joystick-gmail-push@gen-lang-client-0159109182.iam.gserviceaccount.com`.

Railway, `bldg-admin-api`:

| Variable | Value |
|---|---|
| `GMAIL_REPLY_DETECTION` | `on` |
| `GMAIL_PUSH_TOPIC` | `projects/gen-lang-client-0159109182/topics/joystick-gmail-inbox` |
| `GMAIL_PUSH_AUDIENCE` | `https://admin.bldg.chat/api/integrations/gmail/push` |
| `GMAIL_PUSH_SERVICE_ACCOUNT` | `joystick-gmail-push@gen-lang-client-0159109182.iam.gserviceaccount.com` |

Migration 0159 creates the three tables on deploy.

## Verification

- **Simulated:** unit tests (push auth with real RS256 signatures; classification; processor recovery paths), and MySQL
  integration from a sent message to a recorded reply, Claire's tool, the follow-up gate and the push endpoint.
- **Not yet done:** a live Gmail watch, a live Pub/Sub push or a real reply through Google. Those need the Google Cloud
  setup above and the Railway variables. Do not claim production reply detection works until that live test has run.
