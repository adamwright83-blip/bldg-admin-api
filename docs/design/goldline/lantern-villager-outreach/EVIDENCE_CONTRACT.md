# Cozy outreach evidence contract

The executable contract is `shared/cozyVillagerEvidence.ts` (`COZY_VILLAGER_EVIDENCE_CONTRACT`). This note names the durable facts. It does not add art, scenes, or interactions.

| Shown state | Durable fact | Pose |
|---|---|---|
| Draft Prepared | No outbox row. The suggestion is recomputed from the win-back read (identity, name, days since last order). | idle |
| Scheduled | `scheduled_outreach_messages.status = pending` and `deliveryIntent = scheduled` | wave |
| Awaiting Sender | `awaiting_sender_setup`, or `pending` with `deliveryIntent = immediate` | wave |
| Claimed | `status = claimed` | wave |
| Send Observed | `status = dispatched` and both `dispatchedAt` and `externalMessageId` are present | acknowledged |
| Failed | `status = failed` | idle |
| Reply | Unavailable. This outbox has no inbound row. | unchanged |
| Paid order | Unavailable unless an admitted paid-order reference is passed in for the same `customerId`. Historical dossier order counts are not this evidence. | unchanged |

`externalMessageId` values prefixed `simulated:` are labeled simulated. Acknowledged is not used for scheduled, failed, claimed, or awaiting-sender rows. Selecting a villager can show the existing selected frame while the pointer is there; that selection is not stored.

The Day Line card id is the existing Daphne goal id from `readObjectiveArea`. One card. A send observation may complete that message's outreach action. It does not complete the goal, append `recovery_outreach_completed`, or append `customer_recovered`.

Customer identity is `customerId` plus tenant and operator. Display name is a label. Empty house slots stay empty.
