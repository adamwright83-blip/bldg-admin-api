# bldg-admin-api — context that is easy to miss

This file is loaded automatically. It exists because two specific things in this repo
have already caused wrong work, and neither is discoverable by reading the code you
happen to be editing.

---

## 1. A second repo depends on this one in production

**Adam will not remember to mention this. Assume he hasn't.**

The resident-facing app lives at `/Users/adamwrightpfi/Desktop/Cursor_residentapp`
(HELD / `app.bldg.chat`). It is a **separate repo** that calls **into this one** over
HTTP in production. Nothing in this repo imports it, no test here covers it, and it
will not appear in any search you run here.

Adam is not actively developing it (he expects to return to it around **Jan 2027** to
onboard more OPUS LA and Century Park East residents), but residents may be live on it
now. Treat it as a running consumer, not a dormant project.

### The two integration paths

| Path | Endpoint | Auth env var |
|---|---|---|
| Agent tools (primary) | `POST /api/agent/s2s/run-tool` | `ADMIN_AGENT_SHARED_SECRET` |
| Order intake (fallback) | `POST /api/intake/from-bldg` | `APP_SHARED_API_SECRET` |

Both default to `https://bldg-admin-api-production.up.railway.app`.

### What you can break from inside this repo, silently

- **Renaming or deleting a tool** in `server/agents/tools/`, or removing it from the
  `resident_agent` allowlist in `server/agents/permissions.ts`, or from
  `s2sAgentToolAllowlist` in `server/agents/s2sEndpoint.ts`.
  Resident calls these eight by name: `createLaundryOrderTool`, `getResidentContextTool`,
  `draftCustomerMessageTool`, `createResidentAgentPlanTool`, `updateResidentAgentPlanTool`,
  `createResidentCoordinatedRequestTool`, `createOrderFollowupTaskTool`,
  `cancelResidentOrderTool`.
- **Changing tool input shapes** — resident builds these payloads by hand in
  `server/agents/residentAgentClient.ts` (`LaundryOrderToolInput`).
- **Changing tool response shapes** — resident reads `orderId`, `planId`, `requestId`,
  `status`, `residentVisibleStatus`, `nextAction`, `opsTaskId`, `orderCancelled`, and
  unwraps them from any of `body`, `body.result`, `body.output`, `body.result.output`.
- **Changing either shared secret** without updating the resident deployment.

None of the above will fail a build or a test here. It fails in someone's apartment.

### Truth rule this integration already enforces

Resident-coordinated service requests resolve to `pending_provider_confirmation`, never
`confirmed`, because nothing has actually been confirmed by a provider yet. Do not
"simplify" that into a success status.

---

## 2. The agent infrastructure already exists — do not rebuild it

A previous session reported that the agent permission/approval layer did not exist and
proposed building one. It did exist, at `server/agents/permissions.ts`, and was only
found by way of the resident repo. Check here before concluding something is missing.

`server/agents/` contains:

- `agentRuntime.ts` — the tool execution loop
- `toolRegistry.ts` — tool registration
- `permissions.ts` — **per-`AgentType` tool allowlist, hard throw via `assertToolPermission`.**
  Eight agent types including `driver_agent`. This is the runtime enforcement layer for
  any "this agent may / may not do X" rule.
- `humanApproval.ts` — `approvalRequiredToolNames`; gated tools are refused without
  `ctx.approvedByUserId`. `draftCustomerMessageTool` is ungated, `sendCustomerReminderTool`
  is gated — i.e. "draft freely, never send without approval" is already implemented.
- `costTracking.ts`, `agentEvents.ts`, `s2sEndpoint.ts`, and **47 tools** in `tools/`.

**Known gap:** allowlisting controls *actions*, not *assertions*. Nothing yet stops a
drafting tool from producing text that claims a customer already replied. That output-claim
check is genuinely unbuilt.

---

## 3. Goldline work

Read `docs/GOLDLINE-TASKS.md` first, then `docs/goldline/BUILD_BRIEF_SLICES_1_5.md`.

Docs whose headers say "This document constrains future Goldline work" are binding —
`docs/goldline/REALITY_BRIDGE.md` and
`docs/goldline/campaigns/GREYSTAR_COLOSSEUM_SNAPSHOT.md` in particular. The seven
companions (Mara, Sable, Rook, Bront, Ilex, Luma, Orren) and their protected may/may-not
lists are transcribed into `server/companions/seedCompanions.ts`; change the doc first,
then resync the code.

### Verification reality

There is no database in the local build environment (Railway MySQL is private-network
only), and the admin app is behind a password gate, so DB-backed UI changes generally
cannot be exercised locally. Say so plainly rather than claiming verification. Several
bugs have reached production this way.

### Multiple surfaces render the same buildings

`LanternCitySceneV6/LanternCityScene.tsx` is the live Lantern City screen.
`WorldGeographySurface.tsx` powers Home's mini city view. `LanternCityAtlas.tsx` is a
re-export shim; `LanternCityAtlasV5.archived.tsx` is dead. Each owns its own navigation
call sites — a fix applied to one does not apply to the others. This has already shipped
a broken route once.
