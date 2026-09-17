# Dayplay Driver Mission Map System

> Durable product-direction document. This captures the intended driver/mobile mission-map architecture so future coding/design agents can recover the concept from the repo without relying on chat history. It is a product/UX specification, not an instruction to implement immediately unless the active roadmap calls for it.

## Core idea

The driver app should evolve from a single route-screen visual language into **one overworld map populated by multiple mission-node archetypes**.

Claire assembles the day by placing different kinds of real-world work onto the golden path in whatever order is operationally correct and narratively useful.

The player should feel like they are **playing a day**, not merely looking at a route.

The system should support visual and interaction variety across:

- pickups
- dropoffs
- sales stops / conquest missions
- dormant-customer reactivation missions
- Claire review checkpoints
- issue / recovery missions
- optional side quests

This gives Dayplay much more flexibility than a single repeated stop-card pattern.

---

# 1. System model

Think of the driver experience as:

**one overworld + many node archetypes**

not:

**one route screen + repeated generic stops**

The overworld remains visually coherent, but each real-world action type can have its own graphic category, mission framing, proof conditions, and completion behavior.

The golden path is the connective tissue. Claire can place different node types along it each day.

---

# 2. Core mission-node archetypes

## A. Pickup node

**Real action:** pick up laundry.

**Player framing:** secure a resource, retrieve a package, collect a signal, recover cargo.

### UI requirements

- customer/building name
- pickup window
- address
- estimated bag count if known
- `Arrived` CTA
- `Collected` CTA
- optional proof photo
- issue actions such as no answer / not ready / access problem

### Completion proof

- GPS arrival when available
- explicit completion tap
- optional photo or note

### Visual family

Courier / retrieval / satchel / hook / cargo imagery.

---

## B. Dropoff node

**Real action:** deliver finished order.

**Player framing:** return recovered goods, complete a handoff, restore supplies.

### UI requirements

- customer/building name
- ETA
- delivery instructions
- `Arrived` CTA
- `Delivered` CTA
- optional proof photo
- issue actions such as customer unavailable / gate blocked / left with staff

### Completion proof

- GPS arrival when available
- explicit completion
- optional proof photo

### Visual family

Chest / package / return beacon / restoration imagery.

---

## C. Sales-stop / conquest node

**Real action:** pitch a building, manager, property, or business prospect.

**Player framing:** conquest, diplomacy, unlock a gate, clear a stronghold, locate a target.

### UI requirements

- building/business name
- known contact
- mission goal
- talking points
- `Arrived` CTA
- outcome actions:
  - no contact
  - met staff
  - pitched
  - follow-up needed
  - interested
  - rejected

### Completion proof

- GPS
- outcome selection
- optional note / photo / business-card capture

### Visual family

Citadel / fortress / gate / tower / arena / stronghold.

This category should receive some of the most dramatic visual treatment because it represents growth work and often requires the most activation energy.

---

## D. Dormant-customer reactivation node

**Real action:** contact an inactive customer.

**Player framing:** wake a sleeper, relight a lantern, recover a lost signal, restore a beacon.

### UI requirements

- customer identity
- last order date
- prior spend / historical value when truthfully available
- number of prior orders
- Claire's suggested draft
- editable rewrite field
- send/call CTA
- response/outcome logging

### Completion proof

- message sent
- call placed
- later response or resulting order when observed

### Visual family

Sleeping tower / dark lantern / silent beacon / ghost signal / relighting sequence.

The important UX principle is that the behavioral-science intervention should manifest as **the game changing how it asks the operator to act**, not as a clinical SaaS panel exposing COM-B/TDF/BCT terminology.

---

## E. Claire review node

**Real action:** review the day, reassess priorities, prepare a next move, or re-plan.

**Player framing:** mission control, briefing room, command chamber, campfire, war table.

### UI requirements

- concise summary of day so far
- what changed
- what is slipping
- suggested reorder or next move
- one primary recommendation
- accept / dismiss / modify controls

### Completion proof

- review opened
- suggestion accepted, modified, or dismissed

### Visual family

Command room / strategy chamber / comms terminal / field briefing.

Claire should feel like mission control, not generic chatbot support.

---

## F. Issue / recovery node

**Real action:** resolve a problem.

Examples:

- missed pickup
- upset customer
- damaged/missing item
- payment issue
- route delay
- access failure

**Player framing:** ghost signal, containment breach, emergency repair, anomaly, recovery quest.

### UI requirements

- issue summary
- urgency
- affected customer/account
- recommended next action
- call / text / resolve controls
- resolution outcome

### Completion proof

- resolution action
- outcome selection
- note / message / call evidence where available

### Visual family

Interference / unstable energy / anomaly / breach / recovery.

These should feel exceptional rather than routine.

---

## G. Optional side quest

**Real action:** useful but nonessential growth work.

Examples:

- text an old lead
- check in with a property
- leave collateral
- prep outreach
- complete a small follow-up

**Player framing:** bonus mission, side quest, bounty, optional detour.

### UI requirements

- short objective
- why it matters
- expected effort
- skip/defer path

### Completion proof

- observed action or explicit skip/defer

### Visual family

Lighter, playful, lower-stakes treatment.

---

# 3. Daily map logic

## Fixed elements

- world/kingdom background
- golden path
- major landmarks
- player/avatar position
- current-day mission sequence

## Dynamic elements

- which nodes appear
- node type
- ordering
- urgency
- optional vs required state
- mission artwork
- Claire review checkpoints
- dormant/reactivation opportunities
- recovery interrupts

The map should be a **mission composer**, not a static background.

---

# 4. Ordering model

There are two layers of order.

## Operational order

Reality comes first:

- time windows
- route efficiency
- customer commitments
- urgency
- dependencies
- location

## Narrative order

Claire can shape presentation so the day feels playable:

- open with a clear mission
- vary work types
- surface high-interest missions at useful moments
- insert review beats when circumstances change
- present optional side quests when the operator has slack

Narrative presentation must not falsify operational truth.

---

# 5. Kingdom / graphic categories

Mission type and world skin should be separable. A node archetype describes the real action; a kingdom/theme controls its fantasy presentation.

## Citadel / conquest kingdom

Best for:

- sales stops
- property pitches
- account expansion
- gate unlocks

Visual vocabulary:

- fortress
- towers
- gates
- arenas
- diplomacy / conquest

## Lantern / signal kingdom

Best for:

- dormant customers
- retention
- follow-up
- reactivation

Visual vocabulary:

- darkened signals
- relit towers
- sleeping districts
- lost beacons

## Courier / river kingdom

Best for:

- pickups
- dropoffs
- route execution

Visual vocabulary:

- bridges
- waterways
- cargo routes
- relay stations
- movement

## Command / mission-control kingdom

Best for:

- Claire review
- planning
- debrief
- reprioritization

Visual vocabulary:

- strategy chamber
- communications room
- maps
- field briefing

## Recovery / anomaly kingdom

Best for:

- service failures
- route problems
- payment issues
- customer recovery

Visual vocabulary:

- interference
- breach
- corruption
- unstable machinery
- ghost signal

---

# 6. Claire placement rules

Claire is not merely a character layered on top of the route. She is the mission arranger.

Claire may decide:

- which nodes appear
- required vs optional status
- what receives emphasis
- when to surface a side quest
- when a recovery issue interrupts the route
- when to insert a review checkpoint
- when to re-order unfinished future work because reality changed

Claire should optimize for:

1. real business priority
2. route practicality
3. behavioral usefulness
4. pacing / operator activation

### Pickup/dropoff

Present clearly. Do not overcomplicate throughput work.

### Sales stops

Elevate visually. High-value growth work should feel consequential.

### Dormant reactivation

Good moments to surface include:

- slack between physical stops
- high-value dormant opportunity
- non-driving moments
- moments when a quick win may help maintain momentum

### Claire review

Insert when:

- route reality changes
- multiple tasks slip
- there is ambiguity
- day becomes overloaded
- a re-plan could materially improve the day

### Recovery

Interrupt when necessary. Recovery nodes should not become ambient clutter.

---

# 7. Suggested mission-node data contract

A mission node should be able to represent fields such as:

```ts
{
  id,
  type,
  title,
  subtitle,
  realWorldTarget,
  kingdomTheme,
  priority,
  required,
  deadline,
  estimatedDuration,
  location,
  proofType,
  status,
  reward,
  claireIntro,
  primaryCTA,
  secondaryCTAs,
  outcomeOptions,
  supportingFacts
}
```

Supporting facts may include, when truthfully available:

- prior spend
- days inactive
- order count
- bag count / weight
- building units
- last order date
- existing relationship stage

This is conceptual schema guidance, not necessarily the final implementation shape.

---

# 8. Mission-card skeleton

Despite visual variation, node/detail experiences should maintain a recognizable interaction grammar.

## Top

- mission type
- mission title
- urgency / deadline

## Middle

- real target
- key facts
- Claire framing
- contextual art

## Bottom

- primary action
- alternate outcomes
- proof/completion controls

This lets the artwork and fiction vary without making the app confusing.

---

# 9. Node lifecycle states

Nodes should visibly support states such as:

- locked
- available
- active
- completed
- problem
- skipped
- superseded

This is important because Claire may rewrite unfinished future work while completed reality remains immutable.

---

# 10. Example day

A sample day could contain:

1. **Pickup — Courier kingdom**  
   Retrieve a customer's laundry.

2. **Pickup — Courier kingdom**  
   Secure a second load.

3. **Sales stop — Citadel kingdom**  
   Pitch a property manager.

4. **Claire review — Command kingdom**  
   Re-plan after a delay or new information.

5. **Dormant reactivation — Lantern kingdom**  
   Contact a high-value inactive customer.

6. **Dropoff — Courier kingdom**  
   Return a completed order.

7. **Recovery mission — Anomaly kingdom**  
   Resolve an issue that emerged during the day.

The point is not this exact order. The point is that Claire can compose a real day from different mission categories rather than forcing every action into the same visual template.

---

# 11. Recommended first implementation scope

To keep the first pass bounded, support five primary node archetypes first:

1. Pickup
2. Dropoff
3. Sales stop
4. Dormant-customer reactivation
5. Claire review

Later add:

6. Recovery
7. Optional side quest

This is enough to prove the mission-composer model without requiring every possible real-world workflow upfront.

---

# 12. Art / UX direction

The visual direction should preserve the current Goldline/Dayplay rules:

- **light mode only**
- mobile driver experience can be fantasy-heavy and escapist
- the fantasy world should not perceptually feel like Los Angeles
- desktop/admin can remain geographically truthful and more directly tied to the real map
- mobile should feel authored and playable, not like generic SaaS with game decoration
- Claire should read as mission control / companion, not a CRM chatbot
- different mission categories should have recognizably different art families
- art should support the task, not obscure the real business facts underneath

A strong reference concept is the Dayplay mobile mockup where an overworld contains distinct mission categories such as `Wake the Sleepers`, `The Colosseum`, `Delivery Run`, and `Tower Defense`, with Claire able to place these categories in different orders on different days.

---

# 13. Product principle

The existing driver experience is closer to:

**a route UI with game dressing**

The intended system should become:

**a real mission engine capable of expressing the whole day**

The game layer may radically reinterpret *why* the operator is doing something, but the underlying real-world target, business state, proof, and outcome must remain truthful.

**Reality determines what happened. The game is allowed to lie about why it happened.**
