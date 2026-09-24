> **LEGACY DAYFORGE COMPATIBILITY:** Retained historical literals in this file are compatibility/history only; they are not current architecture. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md.

**This document constrains future Goldline work. Current production/main outranks prose.**

# Kingdom 2 companion evaluation

Slice 3, per `docs/goldline/BUILD_BRIEF_SLICES_1_5.md` §3.4: evaluate which existing
companion's protected capability genuinely fits Kingdom 2's real campaign, and
explain why the other candidates fit less well.

## Kingdom 2's real campaign

`the-last-valet-recurring-account-pitch` (seeded in `server/campaignLibrary/seedCampaigns.ts`):
Trailblazer's real-world counterpart pitches a hospitality venue (hotel, event
space, or short-term rental operator) on a recurring valet-adjacent laundry
account — turning around linens, uniforms, or guest laundry on a standing
schedule. The completion condition is a real in-person pitch delivered to a
decision-maker, drafted and followed up using real known context about the
venue.

## The capability this requires

Personalized outreach: drafting a pitch, preparing a follow-up, sequencing
communication toward a specific decision-maker — without fabricating
familiarity, inventing a recipient, or claiming a message was read.

## Evaluation against the roster

| Companion | Fit | Why |
|---|---|---|
| **Rook** | **Fits** | Rook's protected capability is exactly this: "draft outreach; personalize using known context; prepare follow-ups; preserve tone; help sequence approved communication." The may-not list (`fabricate familiarity`, `invent a recipient`, `claim a message was read or answered`) maps directly onto the real risk of this campaign — pretending a venue pitch has more history than it does. |
| Mara | Does not fit | Mara finds *places worth going*, not *what to say once there*. She could help identify candidate venues, but Kingdom 2's real gap is the pitch itself, not venue discovery. |
| Sable | Does not fit | Sable's capability is recalling prior history with a target. The Last Valet's campaign is a first pitch to a new account category — there is no prior encounter yet for her to recall. |
| Bront | Does not fit | Bront structures pricing and offer language once a conversation is already happening. The campaign's completion condition is reaching the pitch, not negotiating terms after it — premature for this Kingdom. |
| Ilex | Does not fit | Ilex interprets signals from conversations that have already occurred. There is no conversation history yet to interpret. |
| Luma | Does not fit | Luma produces creative collateral (flyers, visual concepts). The campaign's real bottleneck is not materials — Adam already has real photos/service info — it is personalized outreach to a specific decision-maker. |
| Orren | Does not fit | Orren sequences routes and nearby actions. Useful for *getting there* efficiently, not for *what to say* once arrived, which is Kingdom 2's actual requirement. |

## Assignment

**Rook** is assigned as the Kingdom 2 unlock.

## Rook naming

Rook is `companion.rook`. He is not Claire and not a DayForge field coach. CONTACT (`capability.rook.contact`) is the player-facing mechanic. `rook.outreach_drafting` is the implementation capability id, not the Companion. Owning the Companion does not grant that capability unless an explicit authored rule and a permission rule both say the grant follows ownership.

`server/legacyLegacyDayforgeCoaching/legacyLegacyDayforgeCoachingRuntime.ts` and the public LegacyDayforge landing are `legacy.dayforge`. They reuse the name. The seeded `unifiedProductPersona` flag still records an older unification; it does not make Rook a DayForge coach.

## Colosseum level resolution and Rook's party

Rook joins the party when `level.colosseum` resolves — the same local-fantasy boundary as the Wayward unlock — and can travel with Trailblazer afterward. That is not `kingdom.brass_republic` completion. Beating Clockhead does not complete the Kingdom. Kingdom completion is a separate authored state. The finale that ends with him only exists once the five real Colosseum campaign outcomes are recorded. Those outcomes are a growth campaign, not Kingdom completion.

His reveal follows WORLD_BIBLE §12 rather than a rescue: rumoured captured, he has been
running an illegal communications network through the Republic's own clocks. After
Clockhead falls, one of his handless dials — a speaker all along — crackles: "You took
your time."

What this changes, and what it does not:

- **Party membership** (fiction) is same-device local continuity: recorded per player in
  this device's `localStorage` at the Colosseum-resolution boundary, exactly like the
  Wayward unlock and the local Colosseum resolution it derives from. It is not durable,
  account-level or server state — another device, a cleared browser or a private window
  will not have it. Later kingdoms and the Road read it from
  `client/src/pages/goldline/stages/goldlineParty.ts` (`isTravelingWith`,
  `useGoldlineParty`).
- **CONTACT** (`capability.rook.contact`) is the in-world name of his mechanic: Rook can reach people, open
  conversations, and get through social barriers Trailblazer cannot. The implementation
  capability id is `rook.outreach_drafting` (REALITY_BRIDGE §6). CONTACT is not the Companion.
  The mechanic widens none of the may / may-not rules.
- **The server's evidence-backed unlock is not written.** `earnCompanion` grants the real
  capability only against a completed `ops_tasks` row; the Colosseum's outcomes are
  recorded as open-channel mission tasks, not ops tasks. Whether those campaign outcomes
  should count as that evidence is an open decision for Adam. That decision is not Kingdom
  completion and does not by itself grant `capability.rook.contact`.
- `server/goldlineKingdoms/seedKingdoms.ts` still describes Rook as the companion Kingdom
  2's campaign earns, and every kingdom's `companionEarnedId` is still null. Server code
  was not changed with this section.

## Necessity for Kingdom 3

Kingdom 3's real challenge is not yet defined (open ChatGPT task,
`docs/GOLDLINE-TASKS.md` Backlog). This evaluation cannot yet prove Rook's
outreach capability is *necessary* for Kingdom 3 in the strong sense the Slice 3
success condition asks for — that claim is provisional until Kingdom 3 is
selected through the Admin review surface at `/goldline-kingdoms`. What can be
said now: account-acquisition-shaped growth challenges (the most likely shape
for a Kingdom 3 that follows an account-acquisition Kingdom 2) generally need
outreach capability, so Rook is a reasonable forward bet — but this line item
should be re-checked once Kingdom 3's real campaign is actually selected.
