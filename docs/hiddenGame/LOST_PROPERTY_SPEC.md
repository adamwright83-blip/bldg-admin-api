# LOST PROPERTY (Small Comforts) — Chapters 1–3 Spec, v2

**Status: the single creative and product authority for this build.** Approved by Adam 2026-10-10.
Supersedes the v1 build spec (Project doc `claude/lost-property-chapters-1-3-build-spec.md`, 2026-10-10)
wherever they differ. Reconciled against `docs/JOYSTICK_SYSTEM_MAP.md` §3a, the plate-pipeline decision
(Project doc `claude/lost-property-plate-pipeline.md`), and Adam's stated October direction.

An implementing session executes this document. It does not rewrite it. If something here cannot be
built, document the blocker and keep the requirement; do not substitute.

---

## 0. Decisions locked on 2026-10-10

| Question | Decision |
|---|---|
| Rendering | **Plates + live 3D.** One painted plate per shot; mice are live 3D felt models; the man and other humans are paper cutouts with swappable emotive faces. One three.js runtime draws all of it. |
| Chapter 1 | **Merge.** Breakfast in Bed (approved 2026-10-05) opens it, then the Toaster set piece, then the fourth-suitcase cliffhanger. The v1 Alarm Clock set piece is cut. |
| The man | **Fully visible** paper cutout. He never knowingly sees the mice, except the single frame at the end of Ch.3. |
| Cast | **Three mice: Conductor, Biscuit, Pip.** The system map's "four mice" is corrected to three. |
| Unlocking | **§3a of the system map, unchanged.** v1's "three finished days" rule is withdrawn. |

## 1. Binding rules

- `hidden_game.lost_property` is a Hidden Game inside `admin.lantern_city`. Not a minigame, not a Kingdom.
- **Reality Bridge.** The game reads eligibility. It never writes a business fact. No XP, coins, badges,
  streaks, scores, timers, leaderboards, or fail states (§3a.8).
- **No darkness in Ch.1–3.** Nothing the player sees, hears or reads lets them infer the twist. No clues,
  no satchel, no "cold metal", no ominous notes. Second Look is out of scope for this build.
- **Comedy engine:** good intentions at mouse scale → a human-scale accident → which puts him in front
  of someone kind. Every chapter's arc ends with him receiving kindness from a human.
- **Wrong answers are content.** Every set piece has an intended path and authored wrong branches. Each
  wrong branch is a distinct pratfall of at least 3 seconds, with sound, that returns the player to the
  setup. No "try again" text, ever.
- **The man speaks only the lines in §8.** Every other reaction is wordless: mumble-synth plus his face.
- Code and UI name: `SmallComforts` / "Small Comforts". Do not rename folders.

## 2. Unlock (system map §3a)

**A sale opens the door. Objectives walk you through. Traction earns the ending.**

- **Chapter 1** opens the day the tenant has its **first verified sale in a territory**. The game's entry
  appears in that territory in Lantern City, and Chapter 1 is playable the same day. Nothing gates
  Chapter 1 behind Objectives.
  - "Verified sale" comes from an existing canonical read. Never invent one, never `COALESCE` a tenant.
  - If the only available signal is weaker than a verified sale (for example "has a customer record"),
    stop and report it with file/line evidence. Do not ship a weaker gate under the stronger name.
- **Chapters 2 and 3** each open after **3 completed Day Line Objectives** (Missions, Challenges or Hybrid
  Objectives), counted from the moment the previous chapter opened.
  - Counted from the owning ledgers by completion time, deduplicated by source reference. This must not
    depend on the player opening the game that day; a day the player never opens Lantern City still counts.
  - Count verified **actions**, never sales outcomes.
  - `OBJECTIVES_PER_CHAPTER = 3` is one named, versioned constant.
- **Chapter 4** is the "?" tag. It never unlocks in this build. (The finale is a later traction milestone.)
- **Permanent.** Unlocks are insert-only. No expiry, no clawback, no re-locking.
- **Visible all day (§3a.5).** The eligibility read returns the next chapter and how many Objectives
  remain. The Day Line shows "Tonight: Lost Property, Chapter {n}" only if it fits the existing Day Line
  card system without restyling it. Otherwise ship the data and report the gap.
- **Content note (§3a.9).** At the Lantern City entry: **"Contains mature themes."** Nothing more specific.
- **Chapter tags in the suitcase:** open chapters read "Chapter {n}". The next locked chapter reads
  "{remaining} to go". Further chapters are a blank closed tag. Chapter 4 reads "?".
- **Developer preview.** An owner-only preview plays Ch.1–3 without waiting.
  - Enabled only by server env: `HIDDEN_GAME_PREVIEW_OPEN_IDS` (canonical open ids) AND
    `HIDDEN_GAME_PREVIEW_TENANT_ID`. Unset either one and it is off.
  - The server returns `preview: true`. It never writes unlock rows and never touches business data.
  - The client shows a small "Preview" ribbon. No other user is affected; tests prove it.

## 3. Runtime: plates + live 3D

- **One** three.js renderer is mounted from the existing Lantern City entry (`SmallComforts.tsx`).
  Reuse the existing modules (`game/audio.ts`, `fx.ts`, `mice.ts`, `logic/*`, persistence) where they fit.
  Do not build a second engine. The painted-plate CSS viewer is replaced by this runtime.
- **Layers per shot** (plate-pipeline doc): plate → depth (parallax, slow push-in) → atmosphere (rain,
  lamp flicker, dust, steam) → interactive props (cut-outs or `.glb`, re-lit to match) → characters → sound
  → logic.
- **Each shot ships a data file** with the camera, the plate, a walk/climb navigation mask, and object
  placements with capability tags. Puzzle logic runs on that data, deterministically, testable without a
  renderer.
- **Mice:** live 3D felt models. Hats hover 2–3 px above their heads, always.
- **Humans:** flat paper cutouts. The man has a super-emotive face that can emote in any direction. No
  blonde hair. No tape or joint patches on his limbs. His hair and beard change across chapters (§5).
- **Art dependency.** Plates and felt-mouse models come from Adam (§9). Until a plate arrives, a
  clearly labelled greybox ("PLATE PENDING") may stand in for development. A greybox is never presented
  as visual acceptance, and no generated concept image is ever used in its place.

## 4. Engine

### 4.1 Verbs: every mouse, every object

| Verb | Input | Rule |
|---|---|---|
| **Carry** | tap object → tap destination, or drag | anything tagged `mouseSize`; `heavy` needs Biscuit or two mice. **Pip is `mouseSize`: the others can carry him.** |
| **Climb** | tap a `grip` surface | lining, cords, shelves, bedpost, trouser leg. Vertical pathfinding on the shot's nav mask. |
| **Pull** | hold on a `pullable` | zippers, cords, levers, the clipper cord. Hold length = pull strength. |
| **Squeak** | dedicated button | radius-based; stirs the man and any `listens` object. |

Capability tags live in `logic/objects.ts`: `mouseSize`, `heavy`, `grip`, `pullable`, `listens`, `fragile`,
`warm`, `loud`, `tight`. Puzzles are composed from tags, not scripted hotspots. Remove the shiny-hotspot
affordance; a soft outline marks what the selected mouse can act on.

### 4.2 The three mice

- **Conductor:** grey, navy cap. The leader. Tall: reach +1 cell; pulls cords the others can't reach.
- **Biscuit:** fat and golden, always stuck in something. Strong: carries `heavy`. The only mouse who
  can ride the clippers.
- **Pip:** small and brown, bandaged foot, matchstick crutch. Fits `tight` spaces. **Cannot Climb.**
  Gets anywhere high by being carried.

Switch by tapping a mouse or pressing 1 / 2 / 3. Idle mice wander and fidget on the 12 fps clock.

### 4.3 The man

Paper-cutout actor in `game/man.ts`. State machine `asleep → stirring → awake → (leaves | returns)`.
Senses: sound, light, cold, smell (toast). Each state has thresholds. The stir meter is never a bar; it
shows only as nostril flare and eyebrow.

### 4.4 Chapter state

`logic/chapter.ts`: `ChapterState { chapter: 1|2|3; beat: string; mischiefDone: string[];
wrongAnswersSeen: string[] }`. Each chapter is a linear beat list with optional branches. Saved to
`localStorage` inside try/catch. Required beats gate the chapter's end; optional mischief appears on the
end card.

## 5. Chapters

### Chapter 1 — "Breakfast in Bed"

**Shots:** the suitcase (open on two milk crates, his only table; compartments: lining, zipper
corridor, shoe pocket, lid pocket, with Pip's bed on the high shelf); the apartment at night; the kitchen
counter.

1. **He gets home.** Only his hand reaches in and sets an egg down. *"Lunch. Tomorrow."* The shower starts.
2. **Free Biscuit.** Biscuit is zipped inside the lining. Conductor **Pulls** the zipper: one rising note
   per tooth. Biscuit pops out like a cork.
3. **Set piece A — The Egg Run.** Pip can't reach his bed; the egg is up there too.
   - **Intended:**
     1. Biscuit **Carries** the bottle cap under the end of the zipper.
     2. Conductor **Climbs** to the shoelace, which is tied into a loop he sits in like a sling. He
        **Pulls** to swing: hold builds the arc; release at the top. He backflips into the egg.
     3. The egg rolls down the zipper teeth, one note per tooth, cracks, and the yolk lands in the bottle cap.
     4. Biscuit **Carries** the shells and stacks them into stairs. Pip's crutch goes *crunch* through
        the top step.
     5. They **Carry** the whoopee cushion under the shelf and **Carry** Pip onto it. Biscuit **Climbs**
        to the lid-pocket edge and cannonballs. The fart launches Pip into bed with breakfast intact.
   - **Wrong 1:** Pip on the shoelace. His crutch tangles; he hangs upside down, spinning slowly. Biscuit
     tugs him down by the crutch. *Boing*: crutch and Pip both land.
   - **Wrong 2:** No bottle cap. The egg cracks on Conductor. The yolk sits on his head under the hovering
     hat; he walks it off, hat bobbing on the yolk.
   - **Wrong 3:** Biscuit cannonballs with nobody on the cushion. The fart launches Biscuit himself into
     the lid pocket. The snap closes. A muffled toot from inside.
4. **Biscuit falls asleep** on the cushion. Every snore toots.
5. **He comes back.** His hand pats the empty spot: *"…my egg?"* A toot. The hand freezes.
   *"…Guess I'm fasting now."* The lid slams. One last toot in the dark.
6. **Day interlude** (mice only, he's out). Conductor unzips the lid from inside; the rising zipper notes
   come back. Forage the apartment for comforts. This teaches the bodies: one `heavy`, one `grip`, one
   `tight` object, each needing a specific mouse.
7. **Set piece B — The Toaster.** Evening. Biscuit wants him warm.
   - **Intended:** Biscuit **Carries** Pip up to the counter. Pip squeezes into the toaster slot with a
     sock (`tight`). Conductor **Pulls** the lever. Smoke; the alarm; the man runs out in his underwear.
     Through the open door the neighbour is in the hall, laughing, cast on her left arm. He laughs, for
     the first time. *"Sorry — toaster — I don't even… hi."*
   - **Wrong 1:** Lever with no sock. The toaster pops; Pip is launched onto the ceiling fan and rides it
     two rotations, crutch spinning.
   - **Wrong 2:** Sock, no Pip. The sock pops out flaming. The mice stamp it out in a line like a bucket
     brigade.
   - **Wrong 3:** Squeak while he's holding the toaster. He drops it on his foot and hops.
8. **Night**, then the **morning note** (the existing card), now written by all three mice, about the man.
9. **Cliffhanger.** Morning. The camera is on the apartment door from inside, open a crack. A **fourth
   suitcase** stands in the hall outside, wet from rain. Nobody put it there. Hold 2 seconds. Chapter card.

**Mischief (10).** Required: free Biscuit, Egg Run, Toaster, forage 3 objects, the note. Optional: Egg
Run wrongs 1–3, Toaster wrongs 1–2, the fan ride.

### Chapter 2 — "The Memory"

**Opens in 3D.** The man sits on the bed holding his head. Close-up: he pulls a memory out of his head
like a ribbon, and the camera dives into it. **The memory plays in 2D felt style:** needle-felted mice,
paper humans, drawn as an orthographic layer in the same renderer (no second engine). It returns to 3D at
the end. In the memory: a kitchen in daytime, a small child's drawing of a house on the fridge (just a
house; it must not read as ominous). The man is younger and clean-shaven.

1. **Set piece C — The Haircut (procedural).** The present, 3D. He's asleep, beard grown. The mice decide
   the beard is attacking his face.
   - **The rig:** Conductor **Carries** Pip up onto his nose as lookout. **Biscuit rides** the clippers
     (mash to stay on as they buck). **Conductor steers** by **Pulling** the cord. **Pip calls stirs:**
     when the nostrils flare, release everything, or all three go limp and play dead on his face until
     the stir meter drops.
   - **The cut is real:** the path you actually drive is written to a scalp mask on the cutout's hair
     layer. **He wakes with whatever haircut you drove.** *"…this is a sign."*
   - **Interlude:** a supervised visit, seen as a 2D memory snapshot in a park. His daughter points at
     the haircut, delighted, and he gives her one with his hands.
   - **Wrong 1:** Biscuit falls off. The clippers run away under the bed and come back with a dust-bunny
     beard.
   - **Wrong 2:** Squeak mid-ride. He swats; Conductor swings on the cord like Tarzan.
   - **Wrong 3:** No lookout. He wakes, sees nothing, finds a stripe, shrugs.
2. **Set piece D — The Voicemail (pinball).** His phone buzzes on the nightstand under a glass he left
   there. The mice think it's dying. Conductor **Carries** Pip up; Pip squeezes under the glass and the
   vibration launches him.
   - **The phone is a pinball table:** tilt and flip with two buttons; every bumper is a screen tap. You
     are dialing.
   - **Intended:** the lit lane bounces into his daughter's contact. FaceTime connects; a six-year-old's
     face fills the screen. Pip freezes, hat hovering. *"Daddy… you have a MOUSE?"* The man wakes to his
     kid on video at 11 p.m., delighted. She keeps the secret.
   - **Wrong 1:** Bounce into the lawyer's number. Thirty seconds of hold music; the mice dance; then a
     voicemail beep.
   - **Wrong 2:** Bounce into the flashlight. A strobe disco.
   - **Wrong 3:** Carry the glass off. The phone skitters under the bed; Biscuit brings it back,
     vibrating, like a jackhammer.
3. **Cliffhanger.** Pip finds a page in a notebook under the bed: a drawing of a house with one window
   circled. He can't read. He tears it out and makes it his mattress. Morning: the man, looking for the
   notebook, finds the page gone. He looks around the room for a long beat. The first time he wonders.
   Chapter card.

**His look:** beard grown at the start; the driven haircut from Set piece C onward, kept into Ch.3.

**Mischief (10).** Required: Haircut, Voicemail, the memory, the note, the cliffhanger. Optional: Haircut
wrongs 1–3, Voicemail wrongs 1–2.

### Chapter 3 — "The Neighbour"

1. **Set piece E — The Groceries (top-down).** The neighbour drops her bags in the stairwell; oranges
   scatter down a flight. **The camera snaps to top-down.**
   - **Intended:** Pip is inside a tipped orange, rolling it like a hamster ball (tilt controls) through
     the stair geometry. Biscuit and Conductor bucket-brigade the rest up. Race the elevator indicator.
     She comes back to repacked bags and an orange pyramid. She knocks on his door: *"Thank you."* He:
     *"…you're welcome."*
   - **Wrong 1:** The orange rolls past the landing and out the mail slot.
   - **Wrong 2:** Biscuit stacks the eggs on the bottom. The pyramid collapses; she catches the top
     orange one-handed.
   - **Wrong 3:** Squeak in the stairwell. Echo; the building's dog answers from three floors down.
2. **Set piece F — The Heimlich (jump rope).** Evening. Still guilty about eating his egg (Ch.1), the mice
   try to feed him an egg. He's asleep; he chokes. The neighbour, cast and all, gets one arm around him but can't get
   the lean. The mice have tied the curtain cord to his belt loop.
   - **Intended:** all three jump the cord on the beat (rhythm input, 4-beat bar) so each pull lands with
     her squeeze. A miss → he sways. Three hits → the egg flies out and Conductor catches it in his hat.
     He backs into the window and falls; she saves him.
   - **Wrong 1:** Pull off-beat. He rotates like a slow top.
   - **Wrong 2:** Pip on the cord alone. Too light: Pip goes up instead of him.
   - **Wrong 3:** Squeak. He inhales; worse. The neighbour glares at the curtain.
3. **Aftermath.** He's on the ground outside; she's kneeling over him. The camera rises to the windowsill:
   three hats hovering just over the ledge. He looks up. **One frame: he sees them.** They duck. He smiles
   at nothing. Chapter card.
4. **End of this build.** The Chapter 4 tag in the suitcase reads only "?". Over it, a luggage tag swings,
   in his handwriting: *"Thank you."*

**Mischief (10).** Required: Groceries, Heimlich, aftermath. Optional: Groceries wrongs 1–3, Heimlich
wrongs 1–3, the dog.

## 6. Feel and audio

- Characters animate on a quantized 12 fps clock; camera, UI and particles run at full rate.
- Squash on landing; overshoot on placement; a 150 ms hold before every pratfall lands; rule of three on
  repeated gags (the third time is faster).
- Lamp off: the real light dims, cool window light takes over, the rain softens, Zzz.
- 60 fps on a mid-range phone. DPR capped at 2. Touch targets at least 44 px.
- **Audio is procedural WebAudio only.** Zipper teeth (a rising note per tooth), egg-roll notes (a
  descending note per tooth), crack, whoopee toots, snore-toots, toaster pop, smoke alarm, clipper buzz
  (sawtooth + wobble), phone vibration (low square burst), pinball bumper (short sine ping), FaceTime
  ring, hold music (4-note loop), stairwell echo, dog bark, jump-rope slap, and his mumble-synth.
  No voice files.

## 7. Acceptance

**Automated (vitest):**
- `logic/chapter.test.ts`: beat progression, required vs optional, save/restore, Ch.4 locked.
- `logic/objects.test.ts`: tag rules (heavy needs Biscuit or two mice; tight needs Pip; reach needs
  Conductor; Pip cannot Climb; Pip can be Carried).
- `logic/haircut.test.ts`: the scalp mask from a driven path is deterministic; the same path gives the
  same cut.
- `logic/pinball.test.ts`: lane → contact mapping; the lit lane reaches the daughter; the others reach the
  authored wrong branches.
- `logic/rhythm.test.ts`: the on-beat window, three-hit success, off-beat sway.
- Every set piece: the intended path and every wrong branch resolve without error (table-driven).
- Server: the unlock rules in §2, including the preview isolation and the never-re-lock tests.

**Manual (record exactly what ran, and on what):** locked and unlocked states; Ch.1–3 end to end; every
wrong answer at least once; reload mid-chapter; private browsing; no console errors.

**Captures** at 390×844 @3x, from the running game: suitcase compartments, the Egg Run swing, the toaster
hallway, the haircut mid-ride, the FaceTime freeze, the orange top-down, the jump rope, the windowsill
hats, and the chapter tags with Ch.4 "?". One recording of 30 seconds or less of the haircut.

## 8. Every spoken or written line (verbatim)

| Where | Who | Line |
|---|---|---|
| Ch.1 beat 1 | the man | "Lunch. Tomorrow." |
| Ch.1 beat 5 | the man | "…my egg?" |
| Ch.1 beat 5 | the man | "…Guess I'm fasting now." |
| Ch.1 Toaster | the man | "Sorry — toaster — I don't even… hi." |
| Ch.2 Haircut | the man | "…this is a sign." |
| Ch.2 Voicemail | the daughter | "Daddy… you have a MOUSE?" |
| Ch.3 Groceries | the neighbour | "Thank you." |
| Ch.3 Groceries | the man | "…you're welcome." |
| Ch.3 end | luggage tag | "Thank you." |
| Entry | content note | "Contains mature themes." |

Chapter titles: "Breakfast in Bed", "The Memory", "The Neighbour".

**Changes from v1 forced by the decisions above (for the record):** the Alarm Clock set piece and the fish
tank are cut, so Voicemail Wrong 2 loses "the fish-tank clock gurgles in time"; Reader becomes Pip (he)
and Baker becomes Biscuit; Pip reaches high places by being carried; the man's "explains every event,
wrongly" one-liners are replaced by wordless reactions; the luggage-tag "Tomorrow" becomes "{remaining} to
go". Morning-note text is authored
separately; until then it uses the existing note system and its existing copy.

## 9. Art Adam supplies

**Plates** (no characters, no readable text; fixed camera; dark and warm):

| ID | Shot |
|---|---|
| P1-suitcase | The open suitcase on two milk crates, mouse scale; all four compartments readable in one shot; Pip's bed on the high shelf |
| P1-apartment | His sparse apartment at night: bed, nightstand, window with rain, apartment door |
| P1-kitchen | Kitchen counter at mouse scale with toaster; the apartment door open to the hall |
| P1-door-morning | The apartment door from inside, morning, open a crack onto the hall |
| P2-bed | Close 3/4 overhead of the bed and pillow (he is added as a cutout); nightstand in frame |
| P2-memory-kitchen | 2D felt-style kitchen, daytime, child's house drawing on the fridge |
| P2-memory-park | 2D felt-style park |
| P2-under-bed | Under the bed, low angle, notebook visible |
| P3-stairwell-top | Top-down stairwell: one flight, two landings, elevator indicator, mail slot |
| P3-bedroom-evening | Bedroom, evening, window with curtain cord |
| P3-outside | Outside below his window, looking up at the sill |

**Models:** Conductor, Biscuit and Pip as rigged felt `.glb`s; existing `sc_suitcase_v3.glb`,
`sc_bed_v2.glb` and `sc_lamp_v2.glb` may be reused. **Cutouts:** the man (emotive face set; beard and
hair variants), the neighbour (cast on her left arm), the daughter. **Not needed as art:** the phone
pinball table (drawn in code).

## 10. PR plan

| PR | Scope | Merge |
|---|---|---|
| 1 | Unlock per §2, preview, content note, Day Line data; rework of branch `claude/lost-property-pr1-unlock-gate` | **Adam approves** (it has a migration) |
| 2 | Runtime (§3), verbs, bodies, the man, chapter state, wrong-answer framework, feel, audio | when green, after PR 1 is merged |
| 3 | Chapter 1 | when green |
| 4a | Chapter 2 | when green |
| 4b | Chapter 3 | when green |
