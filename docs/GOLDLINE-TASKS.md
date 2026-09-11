# Goldline tasks

Shared task list for Driver/Admin work, tracked across Claude and ChatGPT (Astra) sessions and Adam. Whoever picks up work here should update this file before finishing — nothing gets marked done or moved without an edit landing in this file.

Sections: Backlog / In Progress / Blocked / Done. One line per task: `- [owner] Title — note`.

## Visual reference guide (read before generating ANY mockup/concept art)
Adam's favorite games, and the ONLY reference feel to pull from: Tomb Raider II, Twisted Metal 2, Metal Gear Solid, Super Mario 3D World. Think: modern-ish adventure grit, velocity/spectacle with personality, stealth-tech military cool, bright dimensional platforming wonder.
Explicitly BANNED, even accidentally: anything Castlevania/gothic-vampire/Transylvania, "knight in shining armor" medieval fantasy, crown iconography, "kingdom" read literally as a medieval castle/throne aesthetic. "Kingdom" is a business-strategy abstraction, not a visual direction — never illustrate it as one.
A generated mockup that leans medieval/fantasy-castle (even a little) is a miss, not a starting point to iterate from — regenerate from this guide, don't patch gold-and-crown UI chrome onto it.

## Canon (standing design facts — not tasks, don't re-derive or re-litigate)
- Each Kingdom's companion is themed to one specific real growth skill (digital marketing/Instagram ads, door-to-door, referrals, retention, etc). The companion is earned through real field work first — it is not a starting option.
- Desktop can host a genuinely playable "game portion" for a Kingdom (e.g. Boreslay, the Headball-2-style PvP game, for the digital-marketing companion), but only once its companion is unlocked. This is the resolution to "does desktop play defeat the purpose since winning needs real-world action": desktop is never a way to skip the real action — the real action is the unlock gate for whichever companion makes that Kingdom's desktop game winnable at all. A kingdom you haven't earned the companion for has no viable desktop game yet.
- Kingdom mission/challenge content itself (the mobile in-field "in-game" portion, e.g. THE LAST VALET) is mobile Driver-app specific, because winning requires real-world actions you can only take while out driving/working. Desktop's role for a Kingdom is the dossier/war-room view (recap, companion state, what real action is still needed) plus, once unlocked, that Kingdom's own desktop game — never a way to play/win the field mission itself from a desk.

## Backlog
- [claude] Build the real mission director — spec written: `docs/goldline/SLICE_4_MISSION_DIRECTOR.md`. BLOCKED on the Slice 1 campaign library (no campaign_library/growth_campaign table exists yet). Do not start without it.
- [adam] Build vetted library of real growth campaigns — door hangers, referral asks, office pitches, retention, digital footprint; the clay for missions
- [chatgpt] Define Kingdom 3's real growth challenge — must come before Companion 2 design, the sequence works backward from this
- [claude] Rewrite The Last Valet's business binding — swap the passive paid-order trigger for a controllable field-action campaign
- [claude] Add Coliseum + Valet as Lantern City thresholds — connect active kingdom state to the Driver day plan, not just Admin
- [adam] Decide the final player entry surface for the chapter — where /goldline-chapter actually gets linked from, and what it says

## In Progress
(nothing currently)

## Blocked
- [adam] Approve and run drizzle/0067 + 0068 migrations — needed before chapter state, event binding, and Echo can go live
- [chatgpt] Design Companion 2's agentic power — blocked on Kingdom 3 definition, power must make K3 genuinely require it
- [claude] Mission Director (Slice 4) — blocked on the Slice 1 campaign library. Spec and data contract are done and reviewable at `docs/goldline/SLICE_4_MISSION_DIRECTOR.md`.

## Done
- [adam] Fix combat aim/cooldown feel — widened hit cone, cooldown button feedback shipped and verified
- [claude] Recover and integrate scenery + heroine art atlases — both art gaps closed from ChatGPT source sheets
