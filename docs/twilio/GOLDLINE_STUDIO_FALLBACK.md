# Goldline Studio fallback

Studio is a future outage path. This document does not install a flow, change a webhook, or turn `CLAIRE_TWILIO_STUDIO_FALLBACK` on.

Goldline remains the place where Claire decides. Studio may only speak the two scripts below, then stop.

## Goldline unavailable

When Goldline cannot answer:

1. Say a generic apology. The apology does not name a customer, an order, a promise, or a next business step.
2. Optionally send one safe SMS to the configured operator. The SMS says Goldline did not answer. It does not include a transcript, a customer fact, or a decision.
3. Hang up.

## Unknown caller

When the caller is not a configured operator:

1. Say a generic restricted response.
2. Hang up.

Do not OTP the caller from Studio. Do not start Claire.

## Studio must not contain

- Weekly logic, including WeeklyIntent
- Daily Command logic, including a primary
- Business decisions: approval, sale, promise, mission, follow-up, assignment
- Story logic or Narrator events
- Customer truth

Those stay in Goldline. A Studio widget that branches on them is out of bounds for this fallback.
