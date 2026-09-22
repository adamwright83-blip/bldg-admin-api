# Conversation Relay transport

`CLAIRE_TWILIO_CONVERSATION_RELAY` defaults off. Production Claire voice stays the existing Gather loop, including xAI speech on that path when it is enabled. The flag does not mark the `conversationRelay` capability LIVE. With the flag off the capability is `DISABLED` / `feature_flag_off`. With the flag on and Twilio account credentials present it is `CONFIGURED`.

Conversation Relay is a speech transport. It may carry speech in and out, token streaming, interruptions, DTMF, silence, and the connection lifecycle. Claire reasoning stays the existing Goldline / Anthropic turn. Relay does not decide business truth, Daily Command, Weekly Mission, Narrator disclosures, commitments, or sales strategy, and it does not place calls.

`ExistingGatherVoiceTransport` and `ConversationRelayVoiceTransport` share operator identity, conversation id, the `claire-call:` conversation state key, and ledger rules. Current Claire speech may arrive as one chunk containing the full string. That chunk is generated, then queued. Playback starting is a separate fact. Heard completely requires explicit playback-complete evidence.

If Claire has started speaking and the operator interrupts, playback stops. The full sentence does not become heard. Narrator disclosure accounting reads that as not confirmed-heard.

The relay socket path is not mounted on the Express app. Inbound, pre-drive, debrief, and status webhooks are unchanged.

Media Streams is not part of this slice. Relay already reports barge-in, so a second bidirectional audio stack is not required for interruption. A raw-audio adapter, if it is ever needed, would be a separate future transport.
