**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# DOCUMENT 4 — GOLDLINE CAMPAIGN PACKET TEMPLATE v1.0

**Purpose:** this is what Codex actually gets for a specific campaign.

Codex should not be handed the entire World Bible when implementing one level unless broader context is truly necessary.

Each packet contains only what that campaign needs.

---

# A. CAMPAIGN IDENTITY

**Campaign:**
`<name>`

**Kingdom:**
`<location>`

**Current authoritative implementation state:**
`existing / partial / new`

**Player fantasy in one sentence:**
Example:

> Cross the Wayward's tethered deck and break into the fortress that has prevented the ship from sailing for generations.

---

# B. FANTASY CONTRACT

Describe only the game.

### Location

What does this place physically look/feel like?

### Culture

At least three pieces of cultural weirdness.

### Trailblazer's immediate goal

Concrete and physical.

### Major characters

Only those relevant.

### Enemies

For each:

* silhouette;
* behavior;
* what it wants;
* why it exists here;
* one memorable interaction.

No filler enemy grocery lists.

### Boss/set piece

Describe:

* visual read;
* attack language;
* traversal;
* escalation;
* win condition.

### Reward/consequence

What changes physically afterward?

---

# C. PLAYABLE STAGE COMPOSITION

For every scene:

### Source environment

What the painting depicts.

### Source aspect

May be wide.

Do not assume final viewport size equals source-image dimensions.

### Final viewport

Mobile portrait.

### Camera start

Where the player initially looks.

### Camera bounds

How far it may pan/push.

### Walk geometry

Define:

* polygons;
* corridors;
* blocked zones;
* narrow bridges;
* side paths.

### Depth

Define ranges used for:

* Trailblazer scale;
* speed if applicable;
* render ordering.

### Foreground masks

Examples:

* rope;
* railing;
* crystal pillar;
* foliage;
* cloth;
* crate stack.

### Live layers

Examples:

* Trailblazer;
* enemies;
* hook rings;
* Gold Line;
* caches;
* moving structures;
* boss;
* Pip.

### Transition nodes

Examples:

* doorway;
* zipline;
* dive;
* root shaft;
* rope climb;
* cannon;
* elevator;
* boss gate.

### Trailer frame

Identify one moment that must look excellent when paused in a vertical screen recording.

---

# D. REALITY CONTRACT

Only if the campaign contains a real-world bridge.

### Real objective

Precisely what useful action exists outside fantasy.

### Known state

What is already authoritative.

### Possible outcomes

Explicit branches.

### Evidence rules

What can prove what.

### Completion condition

Never confuse arrival with meaningful completion where the campaign requires something stronger.

### No-answer branch

What happens.

### Wrong-person branch

What happens.

### Rejection branch

What happens.

### Useful-information branch

What happens.

### Pending branch

What happens.

---

# E. BRIDGE MAPPING

Simple human-readable mappings.

Example:

Real arrival
→ fantasy beacon wakes.

Message actually sent
→ signal leaves kingdom.

Reply received
→ dormant Echo wakes.

Useful new information
→ map/path changes.

Definitive campaign outcome
→ major transformation becomes eligible.

Do not over-specify fiction if different truthful outcomes should produce different reactions.

---

# F. IMPLEMENTATION CONSTRAINTS

List only concrete constraints relevant to the campaign:

* files to inspect;
* systems to reuse;
* existing event types;
* existing mission projections;
* existing art;
* approved characters;
* persistence location;
* mobile regression requirements.

Explicitly state:

> **No parallel architecture.**

---

# G. ACCEPTANCE TEST

A campaign is not complete merely because it compiles.

Check:

### Gameplay

Trailblazer physically moves.

Enemies work.

Collision works.

Camera works.

Depth reads.

Transitions work.

### Visual

Hero readable in <1 second.

Threat readable in <1 second.

Destination readable.

No tiny-character regression.

No entire-level zoom-out.

No obvious flat-JPEG feeling.

### Reality

No fabricated state.

Evidence semantics correct.

Reload/resume correct.

### Fantasy

No dashboard contamination.

No SaaS language leaking into character dialogue.

### Capture

Record on actual target phone viewport.

Would a stranger seeing five seconds think:

> **I want to play that.**

If not, the campaign has not passed.

---

# EXISTING GREYSTAR/COLosseum NOTE

Do **not** create a new Greystar packet that redefines the first campaign from scratch.

Current production already establishes the underlying campaign implementation:

* six fictional Colosseum doors;
* five current real Greystar Koreatown targets;
* completion count five;
* field outcomes projected into Colosseum state;
* six fictional doors explicitly separated from authoritative business count.

`ColosseumBossGate.tsx` already implements the playable arena/field-mode relationship, including joystick gameplay and the real-site hunt.

Any Greystar documentation we create now should be a **snapshot/protection packet of existing behavior plus approved future polish**, not a greenfield specification.

---

These four documents now have distinct jobs:

> **World Bible:** make me desperate to play it.
> **Reality Bridge:** make playing it useful in reality.
> **Implementation Constitution:** stop the software from lying or visually regressing.
> **Campaign Packet:** tell Codex exactly how to build the next piece without losing any of the first three.
