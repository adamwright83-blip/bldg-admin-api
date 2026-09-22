# Conversation Relay transport

`CLAIRE_TWILIO_CONVERSATION_RELAY` defaults off. Production Claire voice stays the existing Gather loop, including xAI speech on that path when it is enabled. The flag does not mark the `conversationRelay` capability LIVE. With the flag off the capability is `DISABLED` / `feature_flag_off`. With the flag on and Twilio account credentials present it is `CONFIGURED`.

Conversation Relay is a speech transport. It may carry speech in and out, token streaming, interruptions, DTMF, silence, and the connection lifecycle. Claire reasoning stays the existing Goldline / Anthropic turn. Relay does not decide business truth, Daily Command, Weekly Mission, Narrator disclosures, commitments, or sales strategy, and it does not place calls.

`ExistingGatherVoiceTransport` and `ConversationRelayVoiceTransport` share operator identity, conversation id, the `claire-call:` conversation state key, and ledger rules. Current Claire speech may arrive as one chunk containing the full string. That chunk is generated, then queued. Playback starting is a separate fact. Heard completely requires explicit playback-complete evidence.

If Claire has started speaking and the operator interrupts, playback stops. The full sentence does not become heard. Narrator disclosure accounting reads that as not confirmed-heard.

The WebSocket upgrade handler is attached to the existing HTTP server, including while the Relay flag is off. It does not add a listener, a port, or a second public origin. A missing or bad Twilio signature is rejected with HTTP 403 before the socket is accepted. That 403 carries the fixed marker `goldline-relay-upgrade-rejected` and does not say whether the signature or the Claire identity failed. Inbound, pre-drive, debrief, and status webhook URLs are unchanged, and their HTTP signature check is unchanged.

`ConversationRelay` does not set `welcomeGreeting`. After setup, the server queues the opening already stored on the Claire conversation, once. Inbound that line is "Hey Adam. What's up?". Outbound it is the briefing already generated for the call.

TwiML sets `interruptible="speech"` and `preemptible="false"`. Outbound text frames set `preemptible` false and omit `interruptible`, so a text message does not override speech barge-in with Twilio's boolean `true` (speech and DTMF). The installed SDK does not type an `events` attribute, and the websocket message reference does not publish `tokens-played` or `speaker-events` payloads, so this slice does not subscribe to them. Sending text is not heard. An interrupt is not heard completely.

`<Connect>` has an HTTPS `action`. `SessionStatus` `ended` or `completed`, or an intentional `{ "type": "end" }`, returns Hangup. `SessionStatus` `failed` may return Gather for the same conversation once. A second failure hangs up. The flag stays off. See `docs/claire/conversation-relay-reachability.md`.

Media Streams is not part of this slice. Relay already reports barge-in, so a second bidirectional audio stack is not required for interruption. A raw-audio adapter, if it is ever needed, would be a separate future transport.
