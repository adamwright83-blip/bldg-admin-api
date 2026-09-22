# Conversation Relay WebSocket reachability

Gather stays the production voice path. `CLAIRE_TWILIO_CONVERSATION_RELAY` stays unset. This note does not change DNS, the inbound Twilio number, Gather webhook URLs, or HTTP signature validation.

## What was probed

Non-destructive checks on 2026-09-22, with no Relay flag and no Twilio signature:

- `GET https://admin.bldg.chat/api/claire/twilio/conversation-relay` returned HTTP 200 `text/html` from Express (`server: Vercel`, `x-powered-by: Express`, `x-railway-edge` set). `vercel.json` rewrites `/api/:path*` to `https://bldg-admin-api-production.up.railway.app/api/:path*`.
- The same GET on the Railway hostname also returned HTTP 200 `text/html`.
- `curl --http1.1` with `Upgrade: websocket` to both hosts returned HTTP 200 `text/html`, not `101 Switching Protocols`.
- A Node `WebSocket` client to `wss://admin.bldg.chat/api/claire/twilio/conversation-relay` and to `wss://bldg-admin-api-production.up.railway.app/api/claire/twilio/conversation-relay` failed with a non-101 status.
- A raw HTTP/1.1 upgrade on the Railway hostname was rejected by the Railway edge (`HTTP/1.1 400`, `Server: Pingora`) before any `101`.

The public Claire host is `ADMIN_BASE_URL`, which defaults to `https://admin.bldg.chat`. An upgrade sent there is answered as an ordinary HTTP document. It does not reach a Conversation Relay upgrade handler.

## PRODUCTION WEBSOCKET REACHABILITY

BLOCKED: the current Vercel/Railway topology does not pass the WebSocket upgrade.

Local tests can attach the handler to the existing `http.Server`. That does not make the public `wss://` path live. Do not set the capability to LIVE from those tests, and do not enable the flag to retest this.

## Optional direct origin

`CLAIRE_TWILIO_RELAY_PUBLIC_BASE_URL` is unset by default. When unset, Relay TwiML and upgrade validation use `ADMIN_BASE_URL` (https rewritten to wss). Gather's `ADMIN_BASE_URL` webhooks stay where they are.

Set the seam only to a public `https://` origin that actually forwards `Upgrade` to this process, for example the Railway service hostname after a later probe shows `101` from that host. The value is an origin only. Do not put a token or other credential in it. Do not set it in Railway until that probe passes. The Connect `action` URL stays on `ADMIN_BASE_URL` because it is a normal HTTPS webhook.

Re-run the probe without enabling Relay:

```bash
node scripts/probeConversationRelayUpgrade.mjs
```

The script prints status codes and whether the response was `101`. It does not print a token-bearing URL.
