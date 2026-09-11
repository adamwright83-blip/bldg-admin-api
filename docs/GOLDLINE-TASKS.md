# Goldline tasks

Shared task list for Driver/Admin work, tracked across Claude and ChatGPT (Astra) sessions and Adam. Whoever picks up work here should update this file before finishing — nothing gets marked done or moved without an edit landing in this file.

Sections: Backlog / In Progress / Blocked / Done. One line per task: `- [owner] Title — note`.

**The build brief is `docs/goldline/BUILD_BRIEF_SLICES_1_5.md`.** It replaces the original five-slice prompt and is written against the code on `main`. Read it before starting any slice.

## Visual reference guide (read before generating ANY mockup/concept art)
Adam's favorite games, and the ONLY reference feel to pull from: Tomb Raider II, Twisted Metal 2, Metal Gear Solid, Super Mario 3D World. Think: modern-ish adventure grit, velocity/spectacle with personality, stealth-tech military cool, bright dimensional platforming wonder.
Explicitly BANNED, even accidentally: anything Castlevania/gothic-vampire/Transylvania, "knight in shining armor" medieval fantasy, crown iconography, "kingdom" read literally as a medieval castle/throne aesthetic. "Kingdom" is a business-strategy abstraction, not a visual direction — never illustrate it as one.
A generated mockup that leans medieval/fantasy-castle (even a little) is a miss, not a starting point to iterate from — regenerate from this guide, don't patch gold-and-crown UI chrome onto it.

## Canon (standing design facts — not tasks, don't re-derive or re-litigate)
- Each Kingdom's companion is themed to one specific real growth skill (digital marketing/Instagram ads, door-to-door, referrals, retention, etc). The companion is earned through real field work first — it is not a starting option.
- Desktop can host a genuinely playable "game portion" for a Kingdom (e.g. Boreslay, the Headball-2-style PvP game, for the digital-marketing companion), but only once its companion is unlocked. This is the resolution to "does desktop play defeat the purpose since winning needs real-world action": desktop is never a way to skip the real action — the real action is the unlock gate for whichever companion makes that Kingdom's desktop game winnable at all. A kingdom you haven't earned the companion for has no viable desktop game yet.
- Kingdom mission/challenge content itself (the mobile in-field "in-game" portion, e.g. THE LAST VALET) is mobile Driver-app specific, because winning requires real-world actions you can only take while out driving/working. Desktop's role for a Kingdom is the dossier/war-room view (recap, companion state, what real action is still needed) plus, once unlocked, that Kingdom's own desktop game — never a way to play/win the field mission itself from a desk.

## Resolved decisions (2026-09-11, Adam)
- Slice 3 companion scope: build the real companion model now (roster rows, may/may-not rules as data, earned/unearned state, unlock transition). Not deferred.
- Rook collision: if Rook wins the Kingdom 3 capability evaluation, unify with the existing shipped Dayforge coach persona rather than renaming either.
- Greystar snapshot: five/ten wording confirmed as described. `day1TenDoors` owns ten real targets, `COLOSSEUM_LEAD_HUNT` is the five-target projection defining Kingdom 1 completion. Amend the protected snapshot doc with this.
- Chapter entry: `/goldline-chapter` is reached through Kingdom 2, which unlocks only after Kingdom 1 (the Greystar hunt + in-fiction Clockhead defeat) is complete. Kingdom 2 is locked on the map until then.

## In Progress
- [claude] Slice 2 — Kingdom sequence and campaign contracts

## Backlog
- [chatgpt] Define Kingdom 3's real growth challenge — must come before Companion 2 design, the sequence works backward from this. Read `docs/goldline/SLICES_1_3_REVISED.md` §2 first: the five/ten target boundary in the brief is imprecise.
- [claude] Slice 4 — Mission Director v1. Spec: `docs/goldline/SLICE_4_MISSION_DIRECTOR.md`. Unblocked now that Slice 1's campaign library exists.
- [claude] Slice 5 — Lantern City, Driver, entry point, persistence. Brief: `docs/goldline/BUILD_BRIEF_SLICES_1_5.md` §5.

## Blocked
- [chatgpt] Design Companion 2's agentic power — blocked on Kingdom 3 definition, power must make K3 genuinely require it

## Done
- [adam] Fix combat aim/cooldown feel — widened hit cone, cooldown button feedback shipped and verified
- [claude] Recover and integrate scenery + heroine art atlases — both art gaps closed from ChatGPT source sheets
- [claude] Slice 1 — Growth campaign library. `server/campaignLibrary/` (schema, service, router), Admin surface at `/goldline-campaigns`, 7 seed campaigns plus the Colosseum campaign expressed through the same model, round-trip test proves byte-identical `LeadHuntDefinition` projection to the existing `COLOSSEUM_LEAD_HUNT`. Verified: `npx vitest run server/campaignLibrary` passes, `tsc --noEmit` clean on touched files.
