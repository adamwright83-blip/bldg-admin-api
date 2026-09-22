# Conversation Relay WebSocket reachability

Gather stays the production voice path. `CLAIRE_TWILIO_CONVERSATION_RELAY` stays unset. This note does not change DNS, the inbound Twilio number, Gather webhook URLs, or signature validation.

The upgrade handler is `attachConversationRelayUpgrade(server)` on the existing HTTP server. That mount does not depend on the Relay flag. The flag only selects Conversation Relay TwiML instead of Gather.

## Three layers

A. **TRANSPORT REACHABLE** — an unsigned WebSocket upgrade reaches our handler and receives our deliberate 403 signature rejection.

B. **AUTHENTICATED UPGRADE PROVEN** — a correctly signed request with a valid Claire token and a persisted Claire conversation receives `101`.

C. **TWILIO END-TO-END PROVEN** — a controlled Twilio Conversation Relay call connects and converses.

The anonymous topology probe tests layer A only, and only after this handler is deployed. It does not require B or C. `101` is not the expected result of an unsigned probe.

## What the 2026-09-22 production probe actually hit

Adam checked production independently. Railway was still running `main` commit `6bee97f0aaa5981e3c372bdaeebdd0a479609161` (PR #216). Draft #217 was not deployed. That process does not contain `attachConversationRelayUpgrade(server)`.

The anonymous probe sent no `X-Twilio-Signature` and no Claire token. Observed responses:

- `GET` and an HTTP/1.1 `Upgrade: websocket` request to `admin.bldg.chat` and to `bldg-admin-api-production.up.railway.app` returned HTTP 200 `text/html`.
- A Node `WebSocket` client received a non-101 status on both hosts.
- A raw HTTP/1.1 upgrade on the Railway hostname received `HTTP/1.1 400` from `Server: Pingora`.

A 200 HTML response from that service means the request did not hit the #217 upgrade handler. The handler was not in the running build. Railway public networking supports WebSockets over HTTP/1.1. That probe does not show the direct Railway origin is unable to carry an upgrade.

After #217 is deployed, the same unsigned request should receive HTTP 403 from this handler, with header `X-Goldline-Relay-Upgrade: goldline-relay-upgrade-rejected` and body `goldline-relay-upgrade-rejected`. The same bytes are returned for a missing or bad Twilio signature and for a Claire identity failure. The response does not say which check failed. `101` still requires a valid Twilio signature for the exact `wss://` URL, a valid Claire token, and a persisted Claire conversation.

## PRODUCTION WEBSOCKET REACHABILITY

NOT PROVEN — the #217 handler has not yet been deployed to the probed Railway production service.

Call the topology BLOCKED only after that handler is deployed and an unsigned Upgrade still fails to reach it.

## Next test

Merge and deploy #217 with `CLAIRE_TWILIO_CONVERSATION_RELAY` still off. Then:

1. Run the anonymous upgrade probe against the direct Railway hostname `bldg-admin-api-production.up.railway.app`.
2. Expect the deterministic Goldline 403 (`goldline-relay-upgrade-rejected`) if the Upgrade reaches the process.
3. Run the same probe against `admin.bldg.chat`.
4. Compare the two classifications.

```bash
node scripts/probeConversationRelayUpgrade.mjs
```

The script prints host, status, content type, whether the Goldline marker was present, and one classification. It does not print a query string, a Claire token, or a Twilio signature.

| Response | Classification |
|---|---|
| 403 with `goldline-relay-upgrade-rejected` | UPGRADE PATH REACHES APPLICATION |
| 200 HTML | REQUEST DID NOT HIT THE UPGRADE HANDLER (old code or proxy downgraded) |
| 400 without the Goldline marker | UPGRADE REJECTED BEFORE OUR HANDLER |
| 403 without the Goldline marker | 403 WITHOUT GOLDLINE MARKER |
| 101 | counted only when `CLAIRE_RELAY_PROBE_MODE=authenticated` and `CLAIRE_RELAY_PROBE_TOKEN` plus `CLAIRE_RELAY_PROBE_SIGNATURE` are already set |

If authenticated mode is set and either value is missing, the script does not send a request and does not ask for the values.

`CLAIRE_TWILIO_RELAY_PUBLIC_BASE_URL` stays unset. Layer A is the Goldline 403 on the unsigned Upgrade. Leave the Relay flag off for this test. Leave the capability off LIVE.
