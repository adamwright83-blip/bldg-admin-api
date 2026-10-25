# JOYSTICK — The First Ten Minutes

**Status:** DRAFT for Adam's approval, 2026-10-25. Not yet binding. Written by Claude after reading the
current onboarding code on `main` and researching Town (town.com) first-session design.
**Audience:** Adam, plus whichever session builds this.
**Scope:** the public path from gojoystick.com to a returning operator's second day. Nothing here touches
the resident app, the eight resident-facing agent tools, or either shared secret.

---

## 0. The one sentence

Town's first ten minutes earn the reaction **"What? You know me?"** Joystick's must earn
**"That's my business. And I can actually play it."** Today the public flow earns neither: a stranger
answers five text questions, enters a card, creates a password, and is shown a generic island map with
no customers on it and a mission to go stand near a public landmark.

---

## 1. What the flow is today (VERIFIED from code, not from production)

Read directly from `main` on 2026-10-25. I could not log in to production, so what gojoystick.com actually
serves at this hour is **UNKNOWN**. No conversion or return numbers were available to me.

| Min | Screen | Where in code |
|---|---|---|
| 0 | Landing hero, tile picks a game or a cozy/road mode | `client/src/pages/JoystickLanding.tsx:23`, `:879-897` send `?mode=` / `?game=` to `/joystick-start` |
| 1 | "Building your starting point…" | `client/src/pages/JoystickAcquisitionPage.tsx:255-265`. The page reads only the `checkout` query param (`:57`, `:117`). **The chosen game or mode is dropped here.** |
| 1–4 | Five text questions, one per screen: what you do all day, where you work, where best customers come from, what you avoid, what one thing changes in 90 days | `shared/goldlineOnboarding.ts:6-10`; truth line "We only know what you tell us. No customers, revenue or results are invented here." |
| 4 | "THAT'S ENOUGH TO START / See your business as a game." then "CLAIRE'S OPENING READ": canonical address plus a briefing paragraph | Interpreted by an LLM from the five answers only (`server/goldlineOnboarding/interpreter.ts`), no records involved |
| 5 | "SAVE THIS WORLD" asks for owner email | `JoystickAcquisitionPage.tsx` identity step |
| 5–6 | "START PLAYING / 7 days, then $49/month. Card required." then Stripe checkout | `server/saas/joystickStripeOffer.ts` ($49 monthly, 7-day trial, card at signup; $468 annual) |
| 6–7 | "PAYMENT RECEIVED / Building your workspace." waits for the signed subscription webhook | `JoystickAcquisitionPage.tsx:289-295` |
| 7 | "ONE LAST LOCK / Create your password." then login, redirect to `/onboarding` | `:230-252` |
| 8 | "Your first world is ready. Start with the business truth you gave us. Connections and customer imports can wait until after your first real action." REVEAL MY WORLD | `client/src/components/goldline/onboarding/GoldlineOnboarding.tsx:85-90`. Paid (acquisition) sessions never see the CSV import at all. |
| 9 | Reveal: geocoded service area compiled into procedural water/land islands, "N TERRITORIES · 0 KNOWN · N UNMAPPED", fog on every island, portals to NEW ORDER / CUSTOMERS / ACTIVE ORDERS / TOWER WARS | `server/goldlineOnboarding/firstMission.ts` `revealWorld`, `DesignPartnerWorld.tsx`, `LocalWorld.tsx` |
| 10 | First mission, archetype `TERRITORY_SCOUT`: "Scout <area>. Visit a publicly accessible spot near <area>. Look for one concrete next step toward: <90-day objective>. Record what you actually observed." | `firstMission.ts` `buildFirstMission` |

Other facts that matter for the redesign:

- **Customer import exists** but only as CSV, up to 100 rows, geocoded, customers only, no orders
  (`server/goldlineOnboarding/customerImport.ts`, `CustomerImport.tsx`). A CleanCloud CSV provider also
  exists with orders (`server/saas/tenantImportProviders.ts:137`).
- **No Gmail import exists for a tenant's customers.** A Google OAuth flow for Gmail does exist, but it is
  the "Jawbreaker" verification path for CleanCloud logins
  (`server/integrations/cleancloud/browserSync/gmailCallback.ts`, `gmailVerification.ts`), and a Google
  Calendar OAuth service exists (`server/googleCalendar/googleCalendarService.ts`). Slice B can reuse that
  OAuth plumbing; it cannot reuse its purpose. INFERRED from headers; neither file read in full.
- **A labelled sample tenant exists:** WRIGHT CONTRACTORS, behind `GOLDLINE_DEMO_BYPASS=true`
  (`server/goldlineOnboarding/demoAccess.ts`), rendered under a "DEVELOPMENT / DEMO ACCESS" banner.
- **Claire's only onboarding role** is `prepareClaireOpening`, which restates three of the operator's own
  answers (`shared/goldlineOnboarding.ts:235-250`). She never reads a record.
- **Brand canon already requires** the selected game to persist across sessions
  (`docs/goldline/JOYSTICK_BRAND_CANON.md`, "Persistence of game choice"). The acquisition page breaks it.

Both outside reviews Adam pasted on 2026-10-25 (ChatGPT, Cursor Astra) diagnosed the five-question
opening correctly. Astra's claim that the landing already contains game-selection handoffs is also
correct; what it did not check is that the handoff is discarded one page later.

---

## 2. What Town does in its first ten minutes, and what we take from it

Sources: Town docs and Learn, the Platformer interview with CEO Jean-Denis Greze, Makerstack, Saner.ai,
a four-month Substack review, AI Marketers Guild. Full write-up in the session of 2026-10-25.

1. **One OAuth, no form.** Google or Microsoft; Gmail, Calendar and Drive in one grant.
2. **Name a being with an address.** The name becomes name@town.com. Reviewers spent the most time here.
3. **The mirror in under a minute.** A dossier of you from your own data, before you have asked anything.
   Greze: "the first a-ha." Corrections are visible and "compound."
4. **It moves first.** Cards from your inbox and calendar, each with a source icon, one click to act.
5. **It comes back to you.** A morning brief at the hour you chose. Overnight the wiki rewrites itself
   and shows "Recent updates."
6. **Candour when unsure.** Their worst incident was confident meeting prep about the wrong person.
   The fix was saying "I'm not sure" and showing both.
7. **Free, no card,** 14-day trial on the paid tier.

What we copy: 1, 3, 4, 5, 6, and the no-card-before-the-mirror principle in 7.
What we beat: Town's mirror is a text page; ours is a neighbourhood you can stand in. Town's cards have
no stakes; our one opportunity is tied to money the operator keeps not collecting. Town cannot phone you.

---

## 3. The target first ten minutes

Principles, in priority order:

1. **Mirror before interview.** The first thing the operator sees after bringing records is their business
   read back to them. Questions come after, and only the two that records cannot answer.
2. **Never invent a customer.** With no records, the operator plays a sample that is labelled SAMPLE
   BUSINESS on every screen and writes nothing into their tenant. (Already a rule: `interpreter.ts`,
   `REALITY_BRIDGE.md`.)
3. **Receipts on every claim.** Each line of the read-back carries its source: "from 84 imported customers",
   "from Gmail, 31 threads", "you told me". Claire may say "I'm not sure yet." This is the Claire truth
   provenance rule applied to minute three.
4. **One opportunity, not five.** Claire picks one, says why, shows the receipt. Reviewers' top complaint
   about Town is noisy suggestion rails.
5. **The game choice survives.** Whatever tile the landing sold is the world that populates.
6. **The world populates from evidence only.** Lantern City lock: customer homes are the lanterns, one
   customer reveals the whole neighbourhood dimmed, everything else fogged. Unresolved addresses stay off
   the map and are listed.
7. **Pay after the mirror, not before.** Same $49 / 7-day offer, moved later. (Adam's decision, §6.)
8. **Tomorrow is scheduled before you leave.** Time and channel chosen, call strictly opt-in.

### Minute by minute

**Minute 0 — Landing.** Unchanged from PR #691. The tile's `game` / `mode` is carried into the acquisition
draft and into the tenant's selected game. Fix the drop at `JoystickAcquisitionPage.tsx`.

**Minute 1 — Bring your business.** One screen, three doors, no questions:

- **Connect Gmail** (new build, read-only scope). The universal source; every operator has one.
- **Drop a customer list** (exists: CSV up to 100). Add one-line export hints for CleanCloud, Square,
  Jobber, QuickBooks. CleanCloud CSV brings orders, which unlocks the strongest opportunity type.
- **I don't have records handy** → the labelled sample. Copy: "You'll play WRIGHT CONTRACTORS, a sample
  business. Nothing here is yours until you bring your own records."

Identity is captured by the OAuth, or by one email field on the CSV path (the existing "SAVE THIS WORLD"
step, moved here and shortened).

**Minutes 2–3 — The read-back.** Progress is visible while the import runs: "Reading 84 customers… 61
addresses placed… Silver Lake, Los Feliz, Echo Park." Then Claire's Opening Read v2, built from records
first and the operator's words second:

- What the business is (from records and the Gmail domain; the operator corrects).
- Where it works (from customer geography, not a typed answer).
- Who matters (top customers by order count if orders exist, else by recency).
- What she is not sure about, said plainly.

Each line has a receipt chip and is tap-to-correct. Corrections are stored as operator-reported facts and
change the next screen. This replaces today's questions one to three.

**Minute 4 — Two questions, from Claire, after she has shown she knows the business.** "What's the part of
the job you avoid?" and "If one thing changed in 90 days, what would it be?" These cannot come from
records and they drive the mission and Daphne's avoidance read. Keep the existing keys `avoidance` and
`objective_90_day`; retire `daily_work`, `service_area`, `customer_source` as questions (they become
corrections to the mirror).

**Minutes 5–6 — Your neighbourhood takes shape.** The chosen game's board fills from the same evidence:
Lantern City lanterns per customer, Beverly Hills plots per order, Century Park East tower. The player
watches it populate; nothing is placed without a geocoded address or a verified record. For the sample,
the board is stamped SAMPLE BUSINESS.

**Minute 7 — One opportunity.** Claire chooses exactly one, by what the evidence can support:

| Evidence available | Opportunity | Receipt | First action | Reality Bridge class |
|---|---|---|---|---|
| Orders (CleanCloud) | A regular past their usual interval: "Maria B. ordered every 11 days for five months. It's been 34." | order history | Claire drafts a message, operator approves, send goes through the approval-gated tool | message sent |
| Customers only (CSV) | "Uncharted: 6 customers in Silver Lake, about 40 unlit doors within two blocks." | geocoded customers | A door-hanger or referral route the operator commits to | GPS arrival / user report |
| Gmail only | "Three people asked about service in the last 60 days and never got an answer." | thread references | A reply draft to approve | message sent |
| Sample | Same three, labelled | fixture | Same, written only to the fixture tenant | none |

The current `TERRITORY_SCOUT` mission is retired as the opening move. It asks for effort with no business
consequence and no evidence class that can prove anything useful.

**Minute 8 — First real action.** Approve and send, or commit to the route. Offer **play this** or **do this
quickly** for the same mission (same permissions, same recorded result). The world acknowledges the action
at once as an action, never as a sale: a lantern flickers, a brazier lights, per `REALITY_BRIDGE.md` §3.
Approval, send, reply, order and payment are recorded as separate events.

**Minute 9 — The card.** "7 days, then $49/month. Card required. One plan. Cancel anytime." Same offer,
same Stripe contract, now placed after the operator has seen their own business and taken one action.

**Minute 10 — Tomorrow.** "When should Claire brief you, and where?" Time plus channel (in-app, SMS, email;
phone call as an explicit opt-in). Promise shown: "Tomorrow I'll tell you what changed, what still needs
you, and one move." On day two the board changes only from verified events, and the briefing names them.

---

## 4. Success, measured

Reuse the existing `captureProductEvent` names where they fit (`onboarding_draft_started`,
`onboarding_question_answered`, `onboarding_identity_*`, `onboarding_checkout_*`,
`onboarding_tenant_provisioned`, `onboarding_owner_activated`, `joystick_first_entry`,
`onboarding_completed`). Add:

- `onboarding_source_connected { kind: gmail | csv | cleancloud | sample }`
- `onboarding_mirror_shown { ms_since_start, customers, resolved, unresolved }`
- `onboarding_mirror_corrected { field }`
- `onboarding_opportunity_shown { type, evidence_class }`
- `onboarding_first_action_approved { type, path: play | quick }`
- `onboarding_briefing_scheduled { channel, hour }`
- `day2_return { source: briefing | direct }`

Founder, demo and test accounts are tagged and excluded.

The release is judged by five businesses Adam does not own:

1. They connect or import real records without help.
2. They say some version of "that's my business" at the mirror (watch them, do not ask).
3. They approve one action in the first session.
4. They come back the next day without Adam prompting them.

Five pilots give direction, not proof. If most still need Adam to operate it, fix that before any new
neighbourhood.

---

## 5. Build slices

No local database exists (Railway MySQL is private-network only). Verification is `railway run` plus a
fresh-tenant walkthrough on production with a throwaway business. Say which was done.

| Slice | What | Touches |
|---|---|---|
| A | Carry game/mode through acquisition; reorder funnel (bring records → mirror → two questions → board → opportunity → action → card → tomorrow) | `JoystickAcquisitionPage.tsx`, `GoldlineOnboarding.tsx`, `server/goldlineOnboarding/router.ts`, `shared/goldlineOnboarding.ts` |
| B | Gmail read-only connector as a tenant import provider: derive contacts and inquiry threads, store references not bodies | new `server/integrations/gmail/`, `server/saas/tenantImportProviders.ts`. Needs a Google OAuth app and verification for the `gmail.readonly` sensitive scope, which takes days to weeks. Start this first. |
| C | Opening Read v2 from records, with receipts and an explicit "not sure" line | `prepareClaireOpening`, the assertion guard path, `interpreter.ts` |
| D | Board population from onboarding evidence, with visible progress; feed Lantern City V7 (`system.geographicTruth.atlas`) and the other games' builders | `firstMission.ts` `revealWorld`, game builders |
| E | Opportunity selector (lapsed regular, uncharted, unanswered inquiry, sample) and the approval-gated first action, projected through the Reality Bridge | `server/claire/`, `server/agents/tools/` (existing tools only; no new resident-facing tool) |
| F | Day-two briefing scheduler: time, channel, call opt-in | `server/claire/` scheduling |
| G | Sample mode: labelled on every screen, isolated to the fixture tenant, resettable | `demoAccess.ts`, `DemoAccess.tsx` |

Slices A and G can ship without B. B is the one that makes "one useful connection" true for a business
that is not a laundry.

---

## 6. Decisions only Adam can make

1. **Card after the mirror** (my recommendation) or keep card-first. Moving it is the single biggest
   change to the funnel and the one Town's free tier makes hard to avoid.
2. **Build the Gmail connector now.** Yes or no. Without it, "bring your business" means CSV for anyone
   who is not on CleanCloud.
3. **Retire `TERRITORY_SCOUT` as the opening mission.** The code can stay for later chapters.
4. **Calls stay opt-in** on day one. Claire reads the mirror aloud in-app; the phone call is offered for
   tomorrow, not forced today.
5. **Five questions become two.** The other three become corrections to the mirror.

---

## 7. Relationship to the other advice (2026-10-25)

- ChatGPT: "one useful connection or customer import, let Claire identify actual opportunities, visibly
  populate the first neighbourhood, labelled sample never invented customers." Adopted in full; this is §3.
- Cursor Astra items 5, 7, 8, 11, 13, 14 are inside this document. Items 2, 3, 4 (tenant identity, paid
  lifecycle, data dependability) are prerequisites and are not re-specified here. Item 9's objection to the
  neighbourhood being Claire's *only* world model is accepted: the board is one projection of the business
  record, and Claire reads the record. Item 15 (understand why work is skipped before making the world
  look worse) is accepted as the order of operations; the board still reflects real consequences such as a
  customer going quiet, never fictional decay from a skipped task.
