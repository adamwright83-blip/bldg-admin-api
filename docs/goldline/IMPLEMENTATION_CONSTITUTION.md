**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# DOCUMENT 3 — GOLDLINE IMPLEMENTATION CONSTITUTION v1.1

**Audience:** Codex / Claude / engineers.
**Purpose:** ten laws implementation may not violate.

## Law 1 — GPS proves arrival, not interaction

A valid position event may establish arrival according to configured accuracy/time constraints.

It cannot establish:

* pitch;
* conversation;
* decision-maker presence;
* commercial outcome.

---

## Law 2 — Evidence proves only itself

A photo proves only what is supportable from the image.

A sent message proves sent.

A reply proves reply.

Do not extend evidence beyond what it actually supports.

---

## Law 3 — User-reported remains user-reported

Player assertions retain provenance unless stronger evidence exists.

Never silently promote:

reported → verified.

---

## Law 4 — Fantasy never creates business truth

No:

* boss defeat;
* bridge activation;
* Gold Line animation;
* NPC dialogue;
* campaign reward

may fabricate real:

* person;
* account state;
* meeting;
* sale;
* response;
* address;
* role;
* revenue;
* outcome.

Ever.

---

## Law 5 — Real can change fantasy; fantasy cannot manufacture real

This is a one-way truth valve.

Real state may project into game state.

Game state may never retroactively create authoritative real state.

---

## Law 6 — Unknown stays unknown

No decision-maker?

Unknown.

No response?

Pending/no response.

No verified outcome?

Do not invent one.

Unknown is a valid game state.

---

## Law 7 — Real action remains inside the adventure

No real-world objective may be presented as:

> stop playing and do work.

The fiction reaches the boundary naturally.

The real action is the continuation of the same mission.

Returning to fantasy is a continuation, not a new productivity workflow.

---

## Law 8 — Agents assist within actual permissions

Agents may:

* research;
* suggest;
* draft;
* organize;
* interpret;
* prepare.

They may perform consequential external actions only where product permissions explicitly allow.

No agent fills missing reality with invention.

---

## Law 9 — Reality saying “no” is canonical

Rejection, no answer, wrong person, closure and failure are all legitimate states.

Goldline may react creatively.

Goldline may not fake success.

---

## Law 10 — Fictional and real progress remain distinct

Game accomplishments can strengthen the adventurer.

Real-world accomplishments can change available fantasy state.

Do not create fake real-world skill statistics such as:

> +25% close rate

because a fictional Relic was equipped.

---

# Presentation Constitution

These rules are just as hard as the truth rules.

## Law 11 — Action-adventure framing is canonical

The rendering technology may be 2D.

The experience must read as cinematic action-adventure.

Trailblazer must be large enough to identify immediately.

---

## Law 12 — The mobile screen is a camera, not the entire world

Source environment art may and often should exceed portrait viewport dimensions.

Camera pans/pushes within the larger stage.

Do not crop every environment to 9:16 and call that the entire level.

---

## Law 13 — Do not expose implementation by zooming out

Never solve navigation difficulty with:

* entire level visible;
* tiny character;
* fixed top-down map-like framing;
* isometric composition;
* platformer composition.

---

## Law 14 — Painted stages need authored geometry

A background image is not navigation.

Every playable stage must explicitly define as necessary:

* walk polygons;
* corridors;
* blocked zones;
* depth;
* interaction areas;
* transition nodes;
* foreground masks.

---

## Law 15 — Live gameplay objects stay live

Do not permanently bake dynamic state into background art when it needs to react.

Examples:

* Trailblazer;
* enemies;
* bosses;
* hook rings;
* caches;
* active Gold Line;
* Trace;
* pickups;
* breakable objects;
* mission-dependent gates;
* animated Pip.

---

## Law 16 — Depth must read

Where useful:

world position
→ screen position
→ perspective scale
→ authored depth speed
→ render order.

Foreground objects can occlude Trailblazer.

---

## Law 17 — Camera is authored

Camera behavior is part of level design.

Use:

* follow damping;
* authored limits;
* destination framing;
* controlled push/pan;
* occasional shake/kick;
* transition framing.

Do not simply center Trailblazer mechanically at all times.

---

## Law 18 — Environment is the stage, not the star

A phone viewer should understand rapidly:

* who I am;
* where I'm going;
* what threatens me;
* what I can interact with.

The repo already contains this principle in the Colosseum capture readability work: hero, boss and incoming threat are intentionally prioritized over scenery.

---

## Law 19 — Use the existing architecture before inventing parallel systems

Before building a new:

* field mission;
* truth store;
* mission state;
* agent event system;
* audio system;
* navigation mechanism,

inspect and reuse production primitives wherever they already solve the requirement.

---

## Law 20 — Current production truth outranks stale prose

When documentation conflicts with:

1. current production/main;
2. merged implementation;
3. current canon;

inspect live code before changing behavior.

Do not rebuild a capability merely because an old planning document describes it as future work.

---

