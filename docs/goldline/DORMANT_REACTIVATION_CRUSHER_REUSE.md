# Dormant Reactivation Rescue — Level 4 Crusher Reuse Audit

**Status:** product/engineering reuse audit. Do not treat this document as implementation truth; current code and business-truth constraints outrank prose.

## Why this exists

Dayplay's dormant-customer mission concept now uses a fantasy villager whose **Spirit Human** is a real dormant customer. The villager is trapped by Clockhead (or a future villain). Reaching the Spirit Human in real life — e.g. sending the dormant customer a real reactivation text — breaks the fantasy-world trap.

An older Level 4 game already implements a pressure mechanic that maps unusually well to this mission: a spiked crusher descends toward a character and forces fast action.

## Existing implementation found on `main`

The old system is not merely recoverable from git history. Its core files and assets still exist on `main`.

Primary files:

- `client/src/components/Level4Offensive.tsx`
- `client/src/components/Level4Offensive.css`
- `client/src/components/Level4OffensiveHost.tsx`
- `client/src/assets/l4/crusher.png`
- `client/src/assets/l4/man.png`
- `client/src/assets/l4/woman.png`
- `server/level4Offensive.ts`
- `server/level4OffensiveCopy.ts`
- `server/level4OffensiveCopySanitizer.ts`
- `server/level4OffensiveExecute.ts`

The `/level4` route also still exists in the admin app.

The pressure loop was introduced/refined in historical commit:

`80fc7f4d5028bc74b6cbdb7234ebf8a27fe86064` — `feat(level4): short-round pressure with HOLD/UNSTABLE and spikey crusher`

## Existing game-state machinery worth reusing

`Level4Offensive.tsx` already has:

- `calm`
- `descent`
- `holding`
- `unstable`
- `impact`
- `resetting`
- `victory`

Current timing model:

- visible descent begins at ~3 seconds
- impact at ~30 seconds
- action click immediately pins the crusher at its current Y
- when the preview becomes visible, HOLD gets a 7-second budget
- then the game becomes UNSTABLE
- after another 3 seconds without commitment, descent resumes from the pinned position
- cancel/error adds a small slip penalty instead of making backing out free
- successful action runs a revive/reset choreography

Other useful implementation already exists:

- refresh-preserved session state so reload cannot trivially reset pressure
- resize-aware crusher travel distance
- reduced/contained motion implementation
- QA simulation overrides including forced HOLD / UNSTABLE / IMPACT / REVIVE
- async action contract: mission CTA can return `Promise<boolean>` and the game only resolves success when the underlying action succeeds
- slow generation does not punish the operator: HOLD stays stable until preview is actually visible
- post-success flash / stamp / recoil choreography

## Why this maps almost perfectly to Spirit Human rescue

Suggested dormant rescue loop:

1. **Mission starts**
   - Clockhead has trapped a random Dayplay villager.
   - The villager's Spirit Human is a real dormant customer.
   - A crusher / threat begins descending toward the fantasy captive.

2. **Operator chooses to act**
   - CTA: `WAKE SPIRIT HUMAN`, `OPEN COMMS`, or equivalent.
   - Existing Level 4 HOLD behavior immediately freezes the threat **before** draft generation begins.
   - This is important: LLM/network latency must never create artificial danger.

3. **Draft appears**
   - Claire presents a truthful reactivation message grounded in the real customer record.
   - Existing HOLD timer begins only now.

4. **Operator hesitates**
   - HOLD → UNSTABLE.
   - Threat shakes / villain regains control.
   - After the unstable budget expires, descent resumes.

5. **Operator sends the real text**
   - The send write must succeed first.
   - Only after a real send receipt / authoritative write should the fantasy rescue complete.
   - Cage opens / crusher stops / villager escapes.

6. **Later customer response is a separate consequence**
   - Sending the message = villager rescued.
   - Customer replies or orders again = later world change, e.g. villager returns home, lantern relights, district wakes, etc.
   - Never imply that sending a text means the customer was successfully reactivated.

## Existing business logic that does NOT directly fit

The old Level 4 host is wired to three older business lanes:

- building penetration
- referral request
- market-hole outreach

The current dormant-customer source is elsewhere:

- `server/strategy/snapshotDormantCustomers.ts`

That implementation truthfully derives dormant customers from tenant-scoped paid-order aggregates using the 30-day inactivity rule.

Do **not** simply replace the old referral lane's label with "dormant customer." The data contract should be rebuilt around real dormant eligibility.

## Critical gap: old execute path does not send anything

`server/level4OffensiveExecute.ts` explicitly says there is **no outbound delivery**. It records an `admin_action_log` decision/attempt so the card can retire.

Therefore the old game currently has a mature **pressure + preview + success choreography**, but not the authoritative dormant-customer SMS action required for rescue truth.

For the new mission:

- the fantasy rescue must not fire when a draft is generated
- it must not fire merely when a local button is clicked
- it must fire only after the actual outbound action returns authoritative success / write receipt
- failure should leave the captive unresolved and surface retry/recovery state

This should conform to Guardrail G4 / VerifiedFactInventory rather than creating a second definition of "sent."

## Identity / PII constraint

`StrategyEngine` dormant snapshots intentionally use hashed customer IDs and do not copy raw phone numbers into Claire strategy context.

The gameplay mission therefore needs two layers:

1. **selection/presentation layer** — may use the hashed dormant candidate and safe facts
2. **authorized execution layer** — resolves that candidate to the authoritative operational customer record and permitted destination only at send time

Do not add phone numbers to the strategy snapshot merely to make the game convenient.

## Visual reuse recommendation

Reuse the **mechanical state machine**, not the old Level 4 art direction wholesale.

The new Dayplay mobile mission should look like a real third-person/first-person action-adventure encounter, not the old admin HUD.

Fantasy target is a **random recurring Dayplay villager**, never a literal depiction of the dormant customer.

Possible scene:

- villager captive in Clockhead's hanging bird cage
- crusher / mechanical threat descending on or around the cage
- player avatar physically present in the scene
- villain visible or communicating through the environment
- Spirit Human link represented as magical signal / tether to the real-world customer

The real customer's name and relevant truthful business facts can appear in HUD-level mission information, but the fantasy captive is a separate game-world person.

## What is reusable vs new

### Reuse heavily

- pressure state machine
- HOLD / UNSTABLE behavior
- preview-latency protection
- cancel slip behavior
- refresh preservation where appropriate
- success/revive choreography architecture
- simulation/QA controls
- async `Promise<boolean>` completion contract
- crusher asset as reference/prototype

### Adapt

- desktop/admin layout → mobile Dayplay encounter
- 3 generic lanes → one mission instance per dormant target
- old `localStorage` lane completion → mission/node lifecycle source of truth
- generic revive visuals → cage rescue / villager escape
- old copy preview → Claire reactivation composer

### Build new

- dormant-target mission adapter
- authoritative mapping from safe dormant candidate to execution identity
- actual outbound send integration + write receipt
- behavioral-ledger events for delivered/engaged/accepted/started/completed/verified as appropriate
- Dayplay villager identity / captivity narrative state
- mission-map node integration
- later reply/order consequence handling

## Engineering caution

Do not revive `/level4` as a product surface just because the code exists.

Treat Level 4 as a **mechanics donor**. Extract or adapt the useful state-machine behavior into the current Dayplay mission architecture so the product does not accumulate two competing game engines.

## Product conclusion

This is **far beyond a concept prototype**. The hardest interaction choreography for the pressure loop already exists and still lives on `main`.

The main missing pieces for dormant reactivation are not the crusher mechanics; they are:

1. clean integration with the new dormant-customer truth source,
2. a real outbound send/write receipt,
3. Dayplay mobile action-adventure presentation,
4. mission-node lifecycle integration,
5. truthful post-send vs post-reactivation consequences.

This should be treated as a reuse/adaptation project, not a greenfield build.
