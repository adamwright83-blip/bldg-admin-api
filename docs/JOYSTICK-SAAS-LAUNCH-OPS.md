<!-- LEGACY DAYFORGE COMPATIBILITY: retired internal names below are compatibility identifiers only; customer-facing product is JOYSTICK. -->\n# JOYSTICK SaaS launch operations

This is the production activation handoff after the code-side SaaS commercialization gates are green.

The customer architecture remains:

**one application → one shared MySQL database → isolated tenant per business**

Do not create a deployment or database per customer.

## 1. Production MySQL recovery gate

Current audited production posture before public launch:

- MySQL service is single-node.
- Scheduled volume backups are not configured.
- Point-in-time recovery (PITR) is not enabled.
- The current custom MySQL start command includes `--disable-log-bin`.
- No restore drill has been proven.

Public paid launch is blocked until at least a scheduled backup and a restore drill on a copy have been completed.

### Enable scheduled backups

In Railway:

1. Open the production MySQL service.
2. Open the mounted volume / Backups controls.
3. Enable a **Daily** scheduled volume backup.
4. Do not replace or recreate the production volume.
5. Wait for a backup to complete and verify the completed backup is visible.

Railway volume backups may also support weekly/monthly schedules. Daily is the minimum launch requirement.

### Restore drill

Never prove recovery by restoring over production.

1. Select a completed production backup.
2. Restore it into a separate restored/sibling volume or service.
3. Leave the source production volume untouched.
4. Start the restored MySQL copy.
5. Verify representative schema and data exist, including:
   - `dayforge_saas_tenants`
   - `dayforge_saas_memberships`
   - `commercial_missions`
   - `claire_conversation_sessions`
6. Record the restore date, source backup timestamp, restored service/volume identity, and verification result.
7. Remove the temporary restore infrastructure only after the drill evidence is recorded.

### PITR

PITR is desirable but is a separate deliberate infrastructure change.

Railway's MySQL PITR flow requires binary logging and Railway's PITR-capable MySQL image. The current service has a custom start command and explicitly disables binary logging, so do **not** attempt a blind automatic conversion.

Before enabling PITR:

1. Confirm the current MySQL major/minor version.
2. Review the custom start-command flags and determine which are still required.
3. Use Railway's current supported PITR conversion flow for the same MySQL major/minor version.
4. Expect one controlled redeploy/downtime event.
5. Verify the first full archive/backup completes and PITR shows a current restorable point.
6. Do not combine PITR conversion with unrelated schema/application changes.

PITR is not a substitute for the restore drill.

## 2. Live Stripe activation

The code-side billing lifecycle is tested with configurable SaaS plans. Do not hard-code one JOYSTICK price or tier.

A plan row owns its Stripe price ID, trial policy, entitlements and plan rules.

### Production secrets

Configure on the production API only when live billing is intentionally being activated:

- `DAYFORGE_BILLING_STRIPE_SECRET_KEY`
- `DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET`
- `DAYFORGE_BILLING_APP_URL` if the production customer URL should differ from the current default
- `DAYFORGE_BILLING_GRACE_DAYS` if the default grace policy should be changed

Historical `DAYFORGE_*` names are compatibility names; customer-facing branding remains JOYSTICK.

### Stripe objects

For every live JOYSTICK tier:

1. Create/confirm the live Stripe Product/Price.
2. Put the live Stripe Price ID in that tier's active SaaS billing-plan row.
3. Configure trial days and entitlement/rules JSON deliberately for that tier.
4. Do not infer pricing from old DayForge founding-plan data.

### Webhook

Production webhook path:

`/api/dayforge/billing/stripe-webhook`

Configure the Stripe live webhook to the actual production API origin plus that path.

At minimum subscribe to the event families already handled by the application:

- `checkout.session.completed`
- `checkout.session.expired`
- `customer.subscription.*`
- `invoice.paid`
- `invoice.payment_failed`

Store the resulting signing secret in `DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET`.

### Controlled live canary

Before putting the public purchase CTA live:

1. Use one controlled canary identity.
2. Select one configured live tier.
3. Complete Checkout.
4. Verify exactly one tenant is provisioned.
5. Activate the owner and sign in.
6. Verify subscription and entitlements.
7. Open the Billing Portal.
8. Exercise the intended cancellation/status path.
9. Verify no duplicate tenant/membership/subscription is produced by webhook retries.
10. Confirm the canary charge/refund/cancellation state in Stripe.

Do not use a real customer as the first live canary.

## 3. Retention activation

The scheduled workflow is:

`.github/workflows/saas-retention.yml`

It is intentionally inert until production configuration is supplied.

Required configuration:

### Production API / Railway

- `DAYFORGE_RETENTION_SECRET`

### GitHub Actions

Repository variables:

- `JOYSTICK_RETENTION_ENABLED`
- `JOYSTICK_RETENTION_BATCH_LIMIT` (optional; bounded by the runner)

Repository secrets:

- `JOYSTICK_RETENTION_URL`
- `JOYSTICK_RETENTION_SECRET`

`JOYSTICK_RETENTION_SECRET` must match the production API's `DAYFORGE_RETENTION_SECRET`.

### Safe activation

1. Configure the matching secrets and production URL.
2. Leave `JOYSTICK_RETENTION_ENABLED` disabled.
3. Manually dispatch the workflow with `dry_run=true`.
4. Verify policy version and eligible counts.
5. Enable `JOYSTICK_RETENTION_ENABLED=1`.
6. Run one bounded non-dry batch manually.
7. Verify only expected expired data was removed.
8. Leave the daily schedule active.

## 4. Customer launch canary

After recovery, Stripe and retention gates are satisfied:

1. Create Customer A through the real paid onboarding path.
2. Import only Customer A's test business book.
3. Verify the customer product contains no Laundry Farm/default-tenant data.
4. Create Customer B independently.
5. Verify A cannot read/write/search/complete/access B's customers, missions, pipeline, churn data, Day Line, team or Claire conversations.
6. Verify B cannot do the same to A.
7. Verify both subscriptions map to their own plans/entitlements.
8. Verify provider/AI cost usage is attributed to the correct tenant.
9. Verify infrastructure logs contain Claire metadata but no raw transcript bodies.

## 5. Production log gate

After the first production deployment carrying the SaaS hardening series:

Inspect production logs for:

- missing table errors
- missing column errors
- migration failures hidden behind success
- raw Claire transcript bodies
- cross-tenant identifiers appearing in another tenant's request path

Do not call launch complete while any required product schema error is recurring.

## Launch definition

The code is launch-capable when CI gates are green.

The public paid product is launch-ready only when all of these operations gates are also true:

- daily production backup configured
- restore drill on a copy proven
- live Stripe plans/secrets/webhook deliberately configured
- controlled live billing canary passed
- retention dry-run and bounded live run passed
- production logs clean after the launch deployment

PITR is strongly recommended before scale; enabling it requires a deliberate human-controlled Railway conversion because of the existing custom MySQL command.