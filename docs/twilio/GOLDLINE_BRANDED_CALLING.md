# Goldline Branded Calling

Reporting and registration notes only. Code in this repository cannot submit, approve, or assign a Branded Calling registration. Claire's dial path does not read branded-calling state. If the registration is missing, Claire still places an ordinary call when her own voice configuration is present.

Account setup that this slice does not perform:

- Trust Hub customer profile
- A Branded Calling bundle in the Twilio Console
- Legal right to the display name and logo
- Assigning Claire's Twilio number to an approved bundle
- Waiting for Twilio review (up to about seven days)

`TWILIO_BRANDED_CALLING_CUSTOMER_PROFILE_SID` only marks the capability configured. It does not activate branding.

## Basic and Enhanced

| Type | What the handset may show | Where |
| --- | --- | --- |
| Basic Branded Calling | Display name | US public beta on T-Mobile and Verizon. Canada, Germany, and the United Kingdom are public beta for Basic only. UK reach is limited for financial, utilities, and government sectors. |
| Enhanced Branded Calling | Display name, logo, and call reason | US general availability on T-Mobile and Verizon. |

Branded Calling is a mobile display. Landlines use CNAM, which is a separate product and is not configured here.

## Display name

- One bundle, one display name, one or more phone numbers.
- A phone number belongs to only one bundle.
- A second display name needs its own bundle.
- Maximum 35 characters.
- Official legal name, brand name, or DBA. An abbreviation must stay recognizable.
- Legally registered in at least one US jurisdiction.
- No non-ASCII or control characters, links, PII, emoji, or misleading content.

## Logo

Enhanced only.

- 32-bit BMP, 256×256.
- No links, QR codes, or misleading content.
- Twilio vets it against trademark registries, including USPTO TESS.
- Some devices show it differently, or not at all.

## Call reason

Enhanced only.

- Maximum 64 characters. Prefer 35 or fewer so it fits a handset.
- Must describe the real reason for the call.
- No links, PII, appointment or health details, emoji, or misleading spelling.
- Not available on every device.

## Carrier and device limits

US Enhanced coverage is T-Mobile and Verizon, not every US carrier.

- Samsung, Motorola, and T-Mobile TCL on Android 14 or later may show display name, logo, and call reason.
- iPhone XS and later on T-Mobile (iOS 18.5 or later) may show display name and logo.
- Verizon iPhone support for display name and logo is newer (iOS 26.5 or later in Twilio's device list) and still device-dependent.
- MVNO devices may show the display name only.
- Verizon may drop the logo and call reason on capped or metered data plans, on BYOD, and when no logo is registered (name + call reason alone is not a Verizon case).
- Verizon Call Filter risk labels override the brand.
- Logo download does not run for a secondary SIM.
- The handset needs its branded-call setting on (iOS Carrier Call Identification, Android Verified Business Call). A VPN can block it.
- Unlocked non-carrier devices often lack Verified Business Calling.

Billing, when a registration exists, is on successful delivery of the brand. This repository does not start that billing.

## What Goldline code will not do

- Create or submit a Trust Hub registration
- Upload a logo or call reason
- Assign a phone number to a bundle
- Refuse or delay a Claire call because branding is unconfigured
- Put an auth token, API secret, or customer profile secret in a log

Public docs used for the limits above: [Branded Calling overview](https://www.twilio.com/docs/voice/branded-calling) and [US Enhanced Branded Calling](https://www.twilio.com/docs/voice/branded-calling/us-enhanced).
