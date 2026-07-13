# DayForge request security

Production configuration:

- `DAYFORGE_ALLOWED_ORIGINS`: comma-separated, exact browser origins added to the first-party CORS list for cookie-authenticated mutations.
- `DAYFORGE_FRAME_ORIGINS`: comma-separated, exact scheduler/widget origins allowed by `frame-src`. The origin of `VITE_SCHEDULER_URL` is also included when that value is available to the server build/runtime.
- `DAYFORGE_SCRIPT_ORIGINS`: comma-separated, exact additional script origins. Existing Stripe and proxied Google Maps sources are included by default.
- `DAYFORGE_CONNECT_ORIGINS`: comma-separated, exact additional API/WebSocket origins. `VITE_API_URL`, `VITE_FRONTEND_FORGE_API_URL`, and `VITE_POSTHOG_HOST` are included when available to the server runtime.
- `DAYFORGE_TRUST_PROXY_CIDRS`: preferred comma-separated Express trust-proxy entries (for example a private proxy CIDR). Raw `X-Forwarded-For` is ignored unless Express trusts the connected proxy.
- `DAYFORGE_TRUST_PROXY_HOPS`: bounded `1`-`3` hop alternative when stable CIDRs are unavailable. Do not set both proxy variables; CIDRs win.

The secure default is no trusted proxy. Browser writes carrying the platform or vendor session cookie must include an allowlisted `Origin`. Requests authenticated with the existing app/agent shared-secret headers remain available to internal services.
