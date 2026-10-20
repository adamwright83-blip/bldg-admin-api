# Silver Lake reunion quests

Status (2026-10-20): **design proposal + one playable prototype, synthetic preview only.** Needs Adam's go-ahead
before anything here reaches real customers. Prototype: `?cozy=1&territory=silver-lake&preview=synthetic`.

Read first: `docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md` §2. Goldline is an **initiation system**. Reunion
quests are a presentation of the same business action (write to a lapsed customer). They are not a claim that
fetch quests make anyone write more letters. See "What this does not claim" below.

## Why

Texting villager after villager is a queue with fur on it. By the fourth door it feels like an inbox. Adam's idea:
each lapsed customer arrives through a tiny, silly errand in the courtyard. The errand ends in a reunion, the reunion
ends at the Letter Desk, and the next errand only opens once the operator has actually decided what to do about
this customer.

The puzzle is the doorway. The decision is the point.

## The loop

```
  giver has a goofy need ──► player finds the item in the world ──► gives it back
                                                                       │
                                     reunion vignette (fiction + real numbers)
                                                                       │
                  "Write to Mei"  ──► the existing PlayableLetterDesk, server's pre-drafted text
                  "Pass on Mei for now" ──► an explicit, recorded pass
                                                                       │
                     REAL DECISION recorded (schedule / hand off / pass) ──► next giver opens up
```

1. **A need.** A fictional resident (Cleo the cat) stands at the customer's doorstep with a small, goofy need:
   "I've got a song stuck in my whiskers and nothing to play it on."
2. **A find.** The item is somewhere in the courtyard: in the roots of a tree, up a tree (hop to reach), behind the crate,
   on the fountain rim. A soft glint marks it. Walk up, press E (or tap the prompt).
3. **A reunion.** Give the item back. A short vignette plays: Cleo plays three wobbly notes, the real customer
   follows the tune into the courtyard, and Cleo recognises them as an old friend. The only numbers are real:
   days since the last order and the paid-order count, from the customer's own record.
4. **An introduction.** Cleo turns to the player: "You should write to Mei." Two buttons: **Write to Mei** opens
   the existing Letter Desk with the server's pre-drafted win-back text, and **Pass on Mei for now**.
5. **The unlock.** The next giver only says one line ("Busy, busy. Come back in a bit?") until the operator has
   made a real decision on this customer. Solving the puzzle alone never counts.

**"Just write to them" is always visible.** Every quest dialogue, in every state, carries a "Just write to Mei"
button that opens the Letter Desk straight away. The neighbours roster still opens any customer's desk directly.
Writing first and never finding the flute completes the quest: business first, fiction optional.

## Guardrails (binding)

1. **The fiction stays in the world.** The Letter Desk, its pre-drafted text and everything sent to the real person
   are unchanged by quests. No flute, cat or courtyard ever enters a message.
2. **Never invent facts about the real customer.** The only customer facts a reunion may show are the slots below,
   all from the customer's own record. A line whose slot is missing is dropped, never guessed.
3. **The customer never speaks.** Narration may say that the customer arrives. Only the fictional giver talks.
   We do not write words, feelings or reasons into a real person's mouth.
4. **No pronouns for the customer.** Lines use the name. We do not infer anyone's pronouns from a name.
5. **Authored templates only.** Quests are a small set of hand-written templates. No model writes quest dialogue.
6. **Truthful states.** A reunion is not outreach. Nothing about a quest changes a customer's communication state,
   and nothing is recorded as sent unless the existing evidence rules already say so.
7. **Cozy.** The giver and the customer use the existing painted villager cards; items are small toon props with the
   courtyard's palette. Nothing from Coastal Market's look.

## Template schema

Code: `client/src/pages/goldline/silverLake3d/reunionQuests.ts`. Hiding spots:
`client/public/assets/goldline/silver-lake-3d/courtyard.json` → `questSpots`, beside `colliders` and `villagerSpots`.

```ts
type ReunionQuestTemplate = {
  id: string;                         // "cat_flute"; stable, versioned with the file
  giver: { variant: VillagerVariant; name: string };  // a fictional resident, never a customer
  item: { kind: QuestItemKind; name: string };        // "flute"; kind picks the toon prop
  spotId: string;                     // courtyard.json questSpots[].id
  lines: {
    locked: string;   // the one-liner while another customer still waits on a decision
    need: string;     // the goofy need; slots: {item} {hint}
    carrying: string; // the player has the item
    waiting: string;  // reunited, no decision yet
    thanks: string;   // a real decision exists
  };
  reunion: { speaker: "giver" | "narrator"; text: string }[];  // 3–5 beats
};

type QuestSpot = {           // courtyard.json questSpots[]
  id: string;
  hint: string;              // "tucked in the roots of the crooked tree by the pumpkins"
  x: number; y: number; z: number;  // Blender coordinates (z up), like every other entry in the file
  reach: "ground" | "hop";   // "hop": only reachable mid-jump
};
```

**Slots.** Every line is filled by one pure function. Allowed slots:

| Slot | Source | If missing |
|---|---|---|
| `{giver}` `{item}` `{hint}` | the template and spot | never missing |
| `{customerName}` | `target.displayName` | never missing |
| `{customerFirst}` | first word of `target.displayName` | never missing |
| `{daysSinceLastOrder}` | `target.daysSinceLastOrder` (server) | the beat is dropped |
| `{paidOrders}` / `{orderWord}` | `target.paidOrders` (server); "order"/"orders" | the beat is dropped |

An unknown slot is a programming error and throws; a unit test fills every template against every synthetic customer.

## Templates

Five, one per giver. A template's giver is never the same animal as the customer it introduces (the assigner skips
to the next template), so the reunion always shows two different villagers.

### 1. `cat_flute`: Cleo's flute (prototype, playable)
- **Giver:** Cleo the cat. **Item:** a little wooden flute. **Spot:** `tree_hollow` (tucked in the roots of the crooked tree by the pumpkins), ground.
- **Need:** "I've got a song stuck in my whiskers and nothing to play it on. I'm sure I saw a flute {hint}."
- **Reunion:**
  1. *narrator* — Cleo plays three wobbly notes. Then a fourth, much worse one.
  2. *narrator* — {customerName} follows the tune into the courtyard.
  3. *giver* — "{customerFirst}! I'd know that walk anywhere. It's been {daysSinceLastOrder} days since your last order. The washing line has been sulking."
  4. *giver* — "{paidOrders} {orderWord} with us, and then the courtyard went quiet."
  5. *giver* — "You should write to {customerFirst}. Go on, I'll keep practising."

### 2. `bunny_kite`: Bella's kite
- **Giver:** Bella the bunny. **Item:** a paper kite. **Spot:** `tree_branch`, **hop** (it is stuck up a tree).
- **Need:** "My kite went on an adventure without me. Last seen {hint}. I can't jump that high. Can you?"
- **Reunion:** Bella runs one lap of the fountain with the kite. {customerName} looks up to watch it. "{customerFirst}! {daysSinceLastOrder} days! The sky's been very boring without you." / "You should write to {customerFirst}."

### 3. `bear_watering_can`: Bruno's watering can
- **Giver:** Bruno the bear. **Item:** a dented watering can. **Spot:** `behind_crate`, ground.
- **Need:** "The pumpkins are thirsty and I've misplaced my watering can. Try {hint}."
- **Reunion:** Bruno waters one pumpkin very seriously. {customerName} stops by the patch. "{customerFirst}! Back after {daysSinceLastOrder} days." / "{paidOrders} {orderWord}: a proper regular." / "You should write to {customerFirst}."

### 4. `otter_duck`: Oliver's rubber duck
- **Giver:** Oliver the otter. **Item:** a rubber duck. **Spot:** `fountain_rim`, ground.
- **Need:** "My duck has gone for a swim without telling me. I think it's {hint}."
- **Reunion:** Oliver floats the duck in the fountain. {customerName} pauses at the edge. "{customerFirst}! {daysSinceLastOrder} days, and the duck kept asking." / "You should write to {customerFirst}."

### 5. `squirrel_acorn_jar`: Sammy's acorn jar
- **Giver:** Sammy the squirrel. **Item:** a jar of acorns. **Spot:** `pumpkin_patch`, ground.
- **Need:** "I hid my acorn jar so well I can't find it. Possibly {hint}. Possibly not."
- **Reunion:** Sammy counts the acorns and loses count. {customerName} wanders over. "{customerFirst}! {paidOrders} {orderWord}. I counted. Then nothing for {daysSinceLastOrder} days." / "You should write to {customerFirst}."

The authoritative text is in `reunionQuests.ts`; this list is the design intent. Change the doc first, then the code.

## Who gets a quest

The assigner (`assignReunionQuests`) is a pure function of the targets the server already projects:

1. Walk targets in slot order.
2. A target is **eligible** when it is actionable now (`communicationState === "draft_prepared"`, consent present)
   and has no real decision yet. Consent-blocked, failed, awaiting-sender and already-decided customers never get a
   quest; they stay plain doorstep villagers exactly as today.
3. Each eligible target takes the next template in order, skipping a template whose giver is the customer's animal.
4. Templates are not reused within one visit. With more eligible customers than templates, the rest stay plain
   villagers until a template frees up.

In the synthetic preview this gives Mei Lin → Cleo's flute, Marcus Vance → Bella's kite, Grace Holloway → Bruno's
watering can.

## The unlock rule

`hasRealDecision(target, passes)` is true when, and only when, one of these is true:

| Evidence | Source |
|---|---|
| `silverLakeStatus.message` is `scheduled`, `compose_handoff_opened`, `operator_reported_sent` or `independently_verified_sent` | server projection |
| `communicationState` is `scheduled`, `claimed` or `send_observed` (or `status` is `scheduled` / `accepted`) | server projection |
| an explicit pass for this customer | the operator pressed **Pass on {customerFirst} for now** |

These do **not** count: finding the item, giving it back, watching the reunion, opening the Letter Desk, choosing an
approach, editing or approving the text, saving a draft, closing the desk.

Quest state follows from that:

- The **active** quest is the first quest in the chain whose customer has no real decision.
- Its giver talks fully: need → carrying → reunion → waiting.
- Every **later** giver says only its `locked` one-liner, plus the "Just write to them" skip.
- Every **earlier** quest is complete: its giver says `thanks`, and its customer stands beside the giver at the doorstep.
- A later customer the operator writes to directly (roster or skip) is complete too; the chain does not wait for it.

The rule is unit-tested in `reunionQuests.test.ts`.

## Where state lives

| State | Synthetic preview (this PR) | Real customers (not built) |
|---|---|---|
| Real decisions | synthetic targets, in memory | server projection, unchanged |
| Pass | in memory | **needs** a server-recorded, append-only pass (operator, customer, time) |
| Quest progress (item found, reunion seen) | in memory | neighbourhood memory (`neighborhoodMemoryService`) |

Quests are **off for real customers** in this PR. Turning them on needs the server-recorded pass first: a pass that
lives only in a browser would let the chain advance without any business record of the choice.

## What this does not claim

- We do not claim quests raise outreach rates, shorten decision latency or recover customers. §2.3 and §2.5 apply:
  an effect claim needs assignment at a defined decision point **and** a baseline arm (the plain roster,
  `STANDARD_PRESENTATION`). Without both, any "quests worked" story is confounded.
- We do not claim the operator read the reunion. A rendered vignette is delivery, not attention (§2.6).
- If we later measure, the proximal outcome is time from reunion to real decision, and the distal outcome is the
  existing independently verified send / reply / paid order evidence. Nothing new is invented for it.

## Prototype scope (this PR)

- Engine for all five templates (spots, items, dialogue states, reunion, unlock), enabled in the synthetic preview.
- Cleo's flute verified end to end: pick the flute, the reunion plays with Mei Lin's real synthetic numbers
  (42 days, 5 orders), the Letter Desk opens. Bella stays on her one-liner until Mei Lin is scheduled or passed.
- Unit test for the unlock rule and slot filling; Playwright in `e2e/goldline-smoke/playableVillagers.spec.ts`.

## Decisions only Adam can make

1. Is the loop right: need → find → reunion → desk, with the next giver locked until a real decision?
2. Does **pass** count as a real decision for unlocking? (Proposed: yes, explicit and recorded, because a chain that
   only advances on a send would push the operator to text people they decided not to text.)
3. Template voice: are the five lines the right kind of silly?
4. Go-ahead to build the server pass record and switch quests on for real customers.
