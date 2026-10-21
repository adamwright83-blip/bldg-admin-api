# Claire call hygiene: closing the stale conversation sessions

This is a one-off operations note, not a migration. Nothing in `drizzle/` changes.

## What was wrong

From 2026-10-01 to 2026-10-20, 18 rows in `claire_conversation_sessions` sat at `status = 'in_progress'` with
`endedAt IS NULL`. All were inbound or ad hoc calls (`pre_drive`, `evening_planning`, `morning_reconciliation`).
Only calls Claire places carry a Twilio `completed` status callback, so only those were ever completed. An inbound
call reaches Claire through the phone number's own webhooks, and a hangup on the Gather path is simply a webhook
that stops arriving.

## What the code now does

- A closed Conversation Relay (`SessionStatus` `ended` or `completed`) completes the session with
  `completionReason = 'relay_closed'` (or `relay_closed_by_claire`).
- A recognised voicemail completes it with `voicemail_detected`.
- `sweepIdleConversationSessions` (`server/claire/conversation/ledgerService.ts`) runs every five minutes in
  production. A session whose last turn, or start, is more than 30 minutes old is completed with
  `completionReason = 'idle_timeout'` and `endedAt` set to that last activity time.
- The sweep closes the row only. It does not run transcript logging or analysis, so it spends no model budget and
  sends no notification about an old call.

Because the sweep closes anything `in_progress` older than 30 minutes, the 18 stale rows will be closed by the first
sweep after this deploys. The SQL below does the same thing by hand, if you want to inspect or do it before then.

## The 18 rows (as of 2026-10-20, prefixes of `id`)

| Kind | Rows |
|---|---|
| `pre_drive` | 49b35ade, d06fc167, 2d521db0, ce81b4d8, f21c8220, 958159a5, 7927b812, 634989f3 |
| `evening_planning` | f67285ee, 8893bd00, 7dd9dcb8, 17f0b53e, b2cc3126, 6bfd9f0d, b95a9cf2, e1c240ba |
| `morning_reconciliation` | 7f687a3e, 62df3040 |

## By hand, read-only first

Connect with the public URL from `railway variables --service MySQL` (`MYSQL_PUBLIC_URL`). Look before you write.

```sql
SELECT s.id, s.conversationKind, s.startedAt,
       (SELECT MAX(t.occurredAt) FROM claire_conversation_turns t WHERE t.sessionId = s.id) AS lastTurnAt,
       (SELECT COUNT(*) FROM claire_conversation_turns t WHERE t.sessionId = s.id) AS turns
FROM claire_conversation_sessions s
WHERE s.status = 'in_progress'
  AND s.startedAt < NOW() - INTERVAL 30 MINUTE
ORDER BY s.startedAt;
```

Expect 18 rows. If the count differs, a call is live or another stale row exists: stop and look.

```sql
UPDATE claire_conversation_sessions s
SET s.status = 'complete',
    s.completionReason = 'idle_timeout',
    s.endedAt = GREATEST(
      s.startedAt,
      COALESCE((SELECT MAX(t.occurredAt) FROM claire_conversation_turns t WHERE t.sessionId = s.id), s.startedAt)
    )
WHERE s.status = 'in_progress'
  AND s.startedAt < NOW() - INTERVAL 30 MINUTE;
```

Then confirm:

```sql
SELECT status, completionReason, COUNT(*) FROM claire_conversation_sessions
WHERE startedAt >= '2026-10-01' GROUP BY status, completionReason;
```

Do not change `recordingStatus`, `transcriptionStatus`, `analysisStatus` or `notificationStatus`. Those columns belong
to the post-call pipeline, and these calls were never finalised by it.

## Open question this PR could not close

Whether Twilio answering-machine detection (`CLAIRE_TWILIO_AMD`) is switched on in production. The Railway variable
API returned errors while this work was done, so the flag was not read. If it is unset, `authorizedAmdCreateFields`
returns the interactive TwiML directly and AMD never runs, which would explain the 2026-10-19 voicemail reaching the
interactive path. The new `claire_outbound_amd_requested` log (at call creation) and `claire_amd_decision` log (on the
AMD webhook, with `AnsweredBy`) will settle it on the next scheduled call.
