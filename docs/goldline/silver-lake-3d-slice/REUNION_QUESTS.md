# Silver Lake reunion quests (v1)

Status (2026-10-20): **v1, approved by Adam to ship.** It is live for real customers, and in the synthetic preview
(`?cozy=1&territory=silver-lake&preview=synthetic`), which never writes.

Read first: `docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md` §2. Goldline is an **initiation system**. Reunion quests
are a presentation of the same business action, writing to a lapsed customer. They are not a claim that errands make
anyone write more letters. See "What this does not claim" below.

## Why

Texting villager after villager is a queue with fur on it. By the fourth door it feels like an inbox. Adam's idea:
each lapsed customer arrives through a tiny, silly errand in the courtyard. The errand ends in a reunion, and the
reunion ends at the Letter Desk. The next errand only opens once the operator has actually decided what to do about
this customer.

The puzzle is the doorway. The decision is the point.

## The loop

```
  giver has a goofy need ──► player finds the item in the world ──► gives it back
                                                                       │
                                     reunion vignette (fiction + real numbers)
                                                                       │
                  "Write to Mei"  ──► the existing PlayableLetterDesk, server's pre-drafted text
                  "Pass on Mei for now" ──► an explicit pass, recorded on the server
                                                                       │
                     REAL DECISION (schedule / hand off / sent / pass) ──► next giver opens up
```

1. **A need.** A fictional resident stands at the customer's doorstep with a small, goofy need. Cleo the cat:
   "I've got a song stuck in my whiskers and nothing to play it on. I need a flute. Something long, hollow and a bit
   bendy."
2. **A find.** The item is somewhere in the courtyard: tucked in the roots of a tree, up a tree (hop to reach it),
   behind the crate, on the washing line. A soft glint and a ring on the ground mark it. Walk up and press E, or tap
   the prompt. For one up high, hop.
3. **A reunion.** Give the item back and a short vignette plays. Cleo lifts the old garden hose like a flute and plays
   three wobbly notes, then a much worse fourth. The real customer follows the tune into the courtyard, and Cleo
   recognises them as an old friend. The only numbers come from the customer's own record: days since the last order,
   and paid orders.
4. **An introduction.** Cleo turns to the player: "You should write to Mei." **Write to Mei** opens the existing
   Letter Desk with the server's pre-drafted win-back text. **Pass on Mei for now** records a pass.
5. **The unlock.** The next giver only says one line ("Busy, busy! Come back in a bit?") until the operator has
   made a real decision on this customer. Solving the puzzle alone never counts.

**"Just write to them" is always visible.** Every quest dialogue and every reunion beat carries a button that opens the
Letter Desk straight away. The neighbours roster still opens any customer's desk directly. Writing first and never
finding the hose completes the quest: business first, fiction optional.

**The world remembers.** A reunited customer stands beside their giver at the doorstep from then on, and after a
decision the giver just says thanks.

## Cats make their own instruments

Cleo's "flute" is never a musical instrument. It is an ordinary found object, a length of old garden hose, which Cleo
plays as if it were a flute, because cats invent their own instruments from whatever they find. The gag only works if
the object is real and ordinary. A unit test fails if the item's name turns into an instrument.

## Guardrails (binding)

1. **The fiction stays in the world.** Quests leave the Letter Desk, its pre-drafted text and everything sent to the
   real person unchanged. No hose, cat or courtyard ever enters a message, and the e2e test checks the letter for that.
2. **Never invent facts about the real customer.** A reunion may show only the customer facts in the slot table below,
   all from the customer's own record. A line whose slot is missing is dropped, never guessed.
3. **The customer never speaks and is never given a feeling.** Narration may say that the customer arrives. Only the
   fictional giver talks. We do not put words, feelings or reasons in a real person's mouth.
4. **No pronouns for the customer.** Lines use the name. We do not infer anyone's pronouns from a name.
5. **Authored templates only.** One hand-written template per villager animal. No model writes quest dialogue.
6. **Truthful states.** A quest event is never an outreach state. A reunion or a pass never marks anything as sent,
   scheduled or handed off, and the Letter Desk, Day Line and outbox never read quest events. A pass is explicit,
   recorded on the server, and changes nothing about the customer's messages.
7. **Never a dead end.** A customer who cannot be contacted (no consent, or consent-blocked) never gets an errand,
   because the errand would end at a letter that cannot be sent.
8. **Cozy.** The giver and the customer use the existing painted villager cards, and items are small toon props in the
   courtyard's palette. Nothing from Coastal Market's look.

## Template schema

Code: `client/src/pages/goldline/silverLake3d/reunionQuests.ts`. Hiding spots are in
`client/public/assets/goldline/silver-lake-3d/courtyard.json` → `questSpots`, beside `colliders` and `villagerSpots`.

```ts
type ReunionQuestTemplate = {
  id: string;                         // "cat_hose_flute"; stored with saved progress, so never rename a shipped id
  giver: { variant: VillagerVariant; name: string };  // a fictional resident, never a customer
  item: { kind: QuestItemKind; name: string };        // "old garden hose"; kind picks the toon prop
  spotId: string;                     // courtyard.json questSpots[].id; one template per spot
  lines: {
    locked: string;   // the one-liner while another customer still waits on a decision
    need: string;     // the goofy need; slots: {item} {hint}
    carrying: string; // the player has the item
    waiting: string;  // reunited, no decision yet
    thanks: string;   // a real decision exists
  };
  reunion: { speaker: "giver" | "narrator"; text: string }[];  // 4–6 beats
};

type QuestSpot = {           // courtyard.json questSpots[]
  id: string;
  hint: string;              // "tucked in the roots of the crooked tree by the pumpkins"
  x: number; y: number; z: number;  // Blender coordinates (z up), like every other entry in the file
  reach: "ground" | "hop";   // "hop": only reachable mid-jump; E does nothing
};
```

**Slots.** One pure function fills every line. These are the allowed slots:

| Slot | Source | If missing |
|---|---|---|
| `{giver}` `{item}` `{hint}` | the template and spot | never missing |
| `{customerName}` | `target.displayName` | never missing |
| `{customerFirst}` | first word of `target.displayName` | never missing |
| `{daysSinceLastOrder}` | `target.daysSinceLastOrder` (server) | the beat is dropped |
| `{paidOrders}` / `{orderWord}` | `target.paidOrders` (server); "order"/"orders" | the beat is dropped |

An unknown slot is a programming error and throws. A unit test fills every template against every synthetic
customer.

## Templates

There are eight templates, one per villager animal, so all eight doorsteps can host an errand. When it can, the
assigner gives a customer a giver of a different animal, so a reunion shows two different villagers.

| Template | Giver | Item (prop) | Spot | Reach |
|---|---|---|---|---|
| `cat_hose_flute` (first, most polished) | Cleo the cat | old garden hose, played as a flute | `tree_hollow`: in the roots of the crooked tree by the pumpkins | ground |
| `bunny_kite` | Bella the bunny | kite | `tree_branch`: up in the big tree, north-west | hop |
| `bear_watering_can` | Bruno the bear | watering can | `behind_crate`: behind the old crate by the lilac cottage | ground |
| `otter_duck` | Oliver the otter | rubber duck | `fountain_rim`: bobbing at the edge of the fountain | ground |
| `squirrel_acorn_jar` | Sammy the squirrel | acorn jar | `pumpkin_patch` | ground |
| `fox_lucky_scarf` | Fennel the fox | lucky scarf | `washing_line`: tangled on the washing line by the orange cottage | hop |
| `badger_spectacles` | Bramble the badger | reading glasses | `mailbox`: on top of the mailbox by the blue cottage | ground |
| `hedgehog_teacup` | Henry the hedgehog | favourite teacup | `under_bench`: under the bench by the fountain | ground |

Cleo's reunion, as written:

1. *narrator*: Cleo lifts the old garden hose like a flute and plays three wobbly notes. Then a fourth, much worse one.
2. *narrator*: Somewhere behind the cottages, a dog howls along.
3. *narrator*: {customerName} follows the tune into the courtyard.
4. *giver*: "{customerFirst}! I'd know that walk anywhere. It's been {daysSinceLastOrder} days since your last order. The washing line has been sulking."
5. *giver*: "{paidOrders} {orderWord} with us, and then the courtyard went quiet."
6. *giver*: "You should write to {customerFirst}. Go on. I'm going to keep practising."

`reunionQuests.ts` holds the authoritative text. Change this doc first, then the code.

## Who gets a quest

The assigner, `assignReunionQuests`, is a pure function of the targets the server already projects and of the saved
progress:

1. It walks the targets in slot order.
2. A target is **eligible** when it has consent, is not consent-blocked, and has no real decision yet. That covers
   draft-ready customers, customers awaiting the sender, and failed sends. Already-decided and consent-blocked
   customers get no new quest and stay plain doorstep villagers.
3. A customer with saved progress (`templateByCustomer`) keeps that errand, even once decided. The giver then just
   says thanks, and the customer stands beside the giver.
4. Every other eligible target takes the next free template whose giver is a different animal, or the next free
   template if only same-animal givers are left.
5. A template is used once per visit. Eight templates cover the courtyard's eight doorsteps.

The chain is assigned once per visit, so a decision made during the visit completes a quest rather than reshuffling the
chain. In the synthetic preview the chain is: Mei Lin → Cleo, Sarah Jenkins → Bella, Marcus Vance → Bruno,
Chloe Bennett → Oliver, Grace Holloway → Sammy.

## The unlock rule

`hasRealDecision(target, passes)` is true when, and only when, one of these is true:

| Evidence | Source |
|---|---|
| `silverLakeStatus.message` is `scheduled`, `compose_handoff_opened`, `operator_reported_sent` or `independently_verified_sent` | server projection |
| `communicationState` is `scheduled`, `claimed` or `send_observed` (or `status` is `scheduled` / `accepted`) | server projection |
| a recorded pass for this customer, less than 7 days old | `silver_lake_reunion_events`, kind `passed` |

These do **not** count:
- finding the item;
- giving it back;
- watching the reunion;
- opening the Letter Desk;
- choosing an approach;
- editing or approving the text;
- saving a draft;
- closing the desk.

Quest state follows from that:

- The **active** quest is the first quest in the chain whose customer has no real decision.
- Its giver talks fully: need → carrying → reunion → waiting.
- Every **later** giver says only its `locked` one-liner, plus the "Just write to them" skip.
- Every **earlier** quest is complete: its giver says `thanks`.
- If the operator writes directly (roster or skip) to a customer further down the chain, that quest completes too, and
  the active quest stays where it is.

`reunionQuests.test.ts` unit-tests the rule.

## Where state lives

| State | Real customers | Synthetic preview |
|---|---|---|
| Real decisions | the server's outreach projection, unchanged | the synthetic targets, in memory |
| Item found, reunited | `silver_lake_reunion_events` (append-only); forgotten after 45 days | in memory |
| Pass | `silver_lake_reunion_events`, kind `passed`; holds for 7 days, then the customer waits on a decision again | in memory |

`silver_lake_reunion_events` (`drizzle/0145`, created in production by `scripts/migrate.mjs`) is append-only and
scoped to the selected business (`ctx.tenantId`). Each row names the signed-in operator. A pass counts in the UI only
after the server has recorded it. If the write fails, the operator is told, and nothing changes.

Procedures: `system.goldlineWorld.reunionQuestEvents` and `system.goldlineWorld.recordReunionQuestEvent`. The proof
reset wipes the table for the proof tenant.

## What this does not claim

- We do not claim quests raise outreach rates, shorten decision latency or recover customers. §2.3 and §2.5 apply:
  an effect claim needs assignment at a defined decision point **and** a baseline arm (the plain roster,
  `STANDARD_PRESENTATION`). Without both, any "quests worked" story is confounded.
- We do not claim the operator read the reunion. A rendered vignette is delivery, not attention (§2.6).
- If we later measure, the proximal outcome is the time from reunion to real decision, and the distal outcome is the
  existing independently verified send / reply / paid order evidence. Nothing new is invented for it.

## Tests

- Unit: `client/src/pages/goldline/silverLake3d/reunionQuests.test.ts` (unlock rule, assignment, slots, guardrails,
  pass expiry) and `server/experience/lanternCity/reunionQuestEvents.test.ts`.
- Browser: `e2e/goldline-smoke/playableVillagers.spec.ts` tests 8–11. They cover:
  - Cleo's hose, the reunion and the desk;
  - a pass unlocking Bella;
  - the skip;
  - a real-customer pass that survives a reload.

  These tests need WebGL. On a runner without it they skip, and say so.

## Later

- Pick each customer's errand from what we know about them (for example, bedding customers get the washing line).
  This needs care, because it would put customer facts into the fiction.
- Make a pass's length (7 days) a setting, if Adam wants a different rhythm.
- Measure against a plain-roster baseline before claiming any effect.
