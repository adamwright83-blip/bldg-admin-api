# JOYSTICK — The First Ten Minutes

**This document constrains future first-session work. Current production/main outranks prose.**

**Status:** Direction approved by Adam on 2026-10-25, with ChatGPT's corrections adopted (§7).
**Audience:** Adam, plus whichever session builds a slice.
**Scope:** the public path from gojoystick.com to a returning operator's second day. Nothing here touches
the resident app, the eight resident-facing agent tools, or either shared secret.

---

## 0. The one sentence

Town's first ten minutes earn **"What? You know me?"** Joystick's must earn
**"That's my business. And I can actually play it."**

The goal is not admiration of a personalised town. It is an operator who wants to come back tomorrow and do
another piece of real work through the game.

---

## 1. What exists today (VERIFIED 2026-10-25)

### 1a. Production entry (checked against gojoystick.com with curl)

| Fact | Evidence |
|---|---|
| The apex homepage is the static page `client/public/joystick-home/`, not `JoystickLanding.tsx` | `middleware.js` rewrites `gojoystick.com/` to `/joystick-home/index.html`; the live page is byte-identical to main |
| The static homepage has **no link to signup**. Every button opens an in-browser sample; both sample endings loop to the other sample | `joystick-home/index.html` links are only `#adventures` and `./`; `app.js` endings call `startSample` |
| `gojoystick.com/joystick-start` returns **404** | `vercel.json` has no rewrite for it |
| `app.gojoystick.com` does not resolve | curl status 000 |
| The funnel is reachable only at `admin.bldg.chat/joystick-start` | 200 there |
| Stripe returns every buyer to `admin.bldg.chat` | `server/saas/saasBilling.ts` `appUrl()` default; the billing return-URL override is not set in production |
| The draft's resume token lives in the starting origin's browser storage | `JoystickAcquisitionPage.tsx` `readCredentials` |

So in production a stranger on gojoystick.com cannot reach signup at all. If the funnel were linked from the
apex as-is, the Stripe return to a different origin would lose the buyer's draft.

`JoystickLanding.tsx` (the SPA landing) does send `?mode=` / `?game=` to `/joystick-start`, but it is not what
the apex serves, and `JoystickAcquisitionPage.tsx` reads only `checkout` from the URL, so the choice is dropped.

### 1b. The funnel itself (VERIFIED from code)

| Step | Screen | Where in code |
|---|---|---|
| 1 | "Building your starting point…" | `JoystickAcquisitionPage.tsx` |
| 2 | Three text questions before checkout: what you do all day, where you work, what you avoid (`JOYSTICK_PREPAY_QUESTION_KEYS`). The other two (best customers, 90-day change) come after checkout in `/onboarding` | `shared/goldlineOnboarding.ts:6-24` |
| 3 | "CLAIRE'S OPENING READ": canonical address and a briefing built from the answers only | `server/goldlineOnboarding/interpreter.ts` |
| 4 | Business name, contact, email ("SAVE THIS WORLD") | `saveJoystickIdentity` |
| 5 | "$79 a month. Card required." then Stripe (was "7 days, then $49/month" until 2026-10-31) | `server/saas/joystickStripeOffer.ts` |
| 6 | Wait for the signed subscription webhook, create password, log in, go to `/onboarding` | `JoystickAcquisitionPage.tsx:230-252` |
| 7 | "Connections and customer imports can wait…" then REVEAL MY WORLD. Paid sessions never see the CSV import | `GoldlineOnboarding.tsx:85-90` |
| 8 | Procedural water/land islands, "0 KNOWN", fog everywhere | `firstMission.ts` `revealWorld`, `LocalWorld.tsx` |
| 9 | `TERRITORY_SCOUT` mission: go stand near a public spot | `firstMission.ts` `buildFirstMission` |

Other facts:

- **Import providers:** `goldline_customer_csv` (customers only, 100 rows, geocoded) and CleanCloud CSV (with
  orders), `server/saas/tenantImportProviders.ts:137`.
- **No Gmail customer import exists.** There is a Gmail OAuth used for CleanCloud login verification
  (`server/integrations/cleancloud/browserSync/gmailCallback.ts`) and a Google Calendar OAuth service.
- **Labelled sample tenant:** WRIGHT CONTRACTORS behind `GOLDLINE_DEMO_BYPASS=true`.
- **Claire's onboarding role** is `prepareClaireOpening`, which restates three of the operator's own answers.
- **No selected-game field** exists on the draft or tenant, although `JOYSTICK_BRAND_CANON.md` requires the
  chosen game to persist.

---

## 2. What Town does, and what we take

Sources: Town docs and Learn, Platformer's interview with CEO Jean-Denis Greze, Makerstack, Saner.ai, a
four-month Substack review, AI Marketers Guild.

1. One OAuth, no form. 2. Name a being with an address. 3. A dossier of you in under a minute ("the first
a-ha"). 4. It moves first, each card with a source icon. 5. A morning brief at a chosen hour and a nightly
self-rewriting wiki. 6. Candour when unsure. 7. Free tier, no card.

We copy 3, 4, 5 and 6, and the principle in 7 that the mirror comes before the card. We do **not** copy an
unlimited free tier: the paid offer stays ($79 a month, no trial, since 2026-10-31; it was $49 with 7 days). We beat Town with a neighbourhood instead of a text page,
stakes instead of suggestions, and a phone call Town cannot make.

---

## 3. The target first ten minutes

Principles, in priority order:

1. **Mirror before interview, and the mirror is free.** The operator sees their own business, read back,
   before any question that records could answer and before the card.
2. **Never invent a customer.** No records means the labelled sample, which writes nothing to their tenant.
3. **Receipts on every claim.** Each read-back line names its source. Claire may say "I'm not sure yet."
4. **One opportunity, not five.**
5. **The game choice survives** from the homepage tile into the world that populates.
6. **The board populates from evidence only** (Lantern City lock: customer homes are the lanterns).
7. **Play before paying; real contact after activation.** The operator can investigate a real customer and
   prepare a message in the game before paying. Contacting anyone requires an activated account. The
   prepared draft survives checkout and the operator returns exactly where they left off.
8. **Tomorrow is scheduled before they leave.**

### The sequence

**0 — Homepage.** The sample stays ("No account needed"). Every sample ending and the closing section offer
**"Bring your own business"** into the funnel, carrying the world they just played. The funnel is served on
gojoystick.com itself and Stripe returns to the origin the buyer started on.

**1 — Bring your business.** Three doors, no questions:

- **Drop a customer list** (exists: CSV). One-line export hints for CleanCloud, Square, Jobber, QuickBooks.
  CleanCloud CSV brings orders, which unlocks the strongest opportunity.
- **Connect a provider we already support** (CleanCloud today).
- **I don't have records handy** → the labelled sample: "You'll play WRIGHT CONTRACTORS, a sample business.
  Nothing here is yours until you bring your own records."

Gmail is **not** a launch door (§5, slice H).

**2–3 — The read-back.** Visible progress while the import runs ("Reading 84 customers… 61 placed… Silver
Lake, Los Feliz, Echo Park"). Then Claire's Opening Read v2, records first, the operator's words second: what
the business is, where it works (from customer geography), who matters, and what she is not sure about. Each
line has a receipt chip and is tap-to-correct. This replaces questions one to three.

**4 — Two questions, both skippable.** "What's the part of the job you avoid?" and "If one thing changed in
90 days, what would it be?" Skipping is allowed; Claire says she will ask again later. Keys stay `avoidance`
and `objective_90_day`.

**5–6 — The neighbourhood takes shape** in the chosen game, from the same evidence. Sample boards are stamped
SAMPLE BUSINESS.

**7 — One opportunity, played.** Claire picks one:

| Evidence | Opportunity | Receipt |
|---|---|---|
| Orders | A regular past their usual interval: "ordered every 11 days for five months; it's been 34." | order history |
| Customers only | "Uncharted: 6 customers in Silver Lake, about 40 unlit doors within two blocks." | geocoded customers |
| Sample | Same, labelled | fixture |

The operator investigates the customer inside the game and prepares the message or route. Nothing is sent.

**8 — The card.** "JOYSTICK, $79 a month. Card required. One plan. Cancel anytime." (no trial since 2026-10-31). Same offer, same Stripe
contract, now after the operator has seen their own business and played with it. The prepared draft is held
on the onboarding session.

**9 — Activate and act.** Password, then the operator lands back on the prepared draft and approves it. The
send goes through the existing approval-gated tool. Approval, send, reply, order and payment are separate
events (`REALITY_BRIDGE.md`). The world acknowledges an action as an action, never as a sale.

**10 — Tomorrow.** Time and channel for Claire's briefing (in-app, SMS, email; phone call strictly opt-in).
"Tomorrow I'll tell you what changed, what still needs you, and one move."

The `TERRITORY_SCOUT` mission is retired as the opening move; the code stays for later chapters.

---

## 4. Success, measured

Existing events stay (`onboarding_draft_started`, `onboarding_question_answered`, `onboarding_identity_*`,
`onboarding_checkout_*`, `onboarding_tenant_provisioned`, `onboarding_owner_activated`,
`joystick_first_entry`, `onboarding_completed`). Add:

- `home_bring_business_clicked { world }`
- `onboarding_source_connected { kind: csv | cleancloud | sample }`
- `onboarding_mirror_shown { ms_since_start, customers, resolved, unresolved }`
- `onboarding_mirror_corrected { field }`
- `onboarding_question_skipped { key }`
- `onboarding_opportunity_prepared { type }`
- `onboarding_first_action_approved { type, path: play | quick }`
- `onboarding_briefing_scheduled { channel, hour }`
- `day2_return { source: briefing | direct }`

Founder, demo and test accounts are excluded. The release is judged by five businesses Adam does not own:
they bring real records without help; they recognise their business at the mirror; they approve one real
action; they come back the next day unprompted. Five pilots give direction, not proof.

---

## 5. Build slices

No local database exists. Verification is `railway run` plus a fresh-tenant walkthrough on production with a
throwaway business. Each PR says which was done.

| Slice | What | Touches |
|---|---|---|
| **A** | Entry: homepage "Bring your own business" into the funnel on gojoystick.com; `vercel.json` rewrite for `/joystick-start`; Stripe returns to the starting origin (allowlisted); the chosen world is carried and stored on the draft | `client/public/joystick-home/`, `vercel.json`, `server/saas/saasBilling.ts`, `saasRouter.ts`, `saasStore.ts`, `JoystickAcquisitionPage.tsx` |
| **B** | Pre-card mirror from a customer CSV. The list stays in the visitor's browser (no server storage, no geocoding before payment); a draft-scoped endpoint returns a summary only; the service-area question is pre-filled from the list for the operator to confirm; after activation the list goes through the normal tenant import and paid sessions can import at all. Cutting to two skippable questions is deferred until the billing-origin change lands, because it touches the same signup-draft file | `JoystickAcquisitionPage.tsx`, `server/saas/saasStore.ts`, `server/goldlineOnboarding/customerImport.ts` |
| **C** | Opening Read v2 from records, with receipts and an explicit "not sure" line | `prepareClaireOpening`, assertion guard path, `interpreter.ts` |
| **D** | Board population from onboarding evidence in the chosen world, with visible progress | `firstMission.ts` `revealWorld`, game builders |
| **E** | Opportunity selector and the playable preview; draft held through checkout; real send only after activation | `server/claire/`, existing `server/agents/tools/` only |
| **F** | Day-two briefing: time, channel, call opt-in | `server/claire/` scheduling |
| **G** | Sample mode labelled on every screen, isolated to the fixture tenant | `demoAccess.ts`, `DemoAccess.tsx` |
| **H** | Gmail investigation, non-blocking. `gmail.readonly` is a **restricted** scope: server-side storage requires Google verification plus a CASA security assessment, with annual re-assessment. An inbox is also not a reliable purchase history. Decide later whether a narrower scope, client-side processing or another source is worth it | research only |

---

## 6. Decisions (made 2026-10-25)

| Decision | Answer |
|---|---|
| Card after the mirror | **Yes** |
| Build Gmail now | **Investigate now; launch does not depend on it** |
| Retire `TERRITORY_SCOUT` as the opening mission | **Yes** |
| Phone calls opt-in on day one | **Yes** |
| Five questions become two | **Yes, and skippable where possible** |
| First real contact before payment | **No.** Play and prepare before the card; send after activation, with the draft preserved |
| Unlimited free tier like Town | **No.** Keep the paid offer ($79 a month, no trial, since 2026-10-31) |

---

## 7. Relationship to outside advice (2026-10-25)

- **ChatGPT, first note:** one connection or import, Claire finds real opportunities, the neighbourhood
  populates visibly, a labelled sample never invents customers. Adopted.
- **ChatGPT, review of this spec:** three corrections adopted. (1) The apex serves the static homepage, which
  had no signup link; verified, and worse than stated (the funnel 404s on the apex and Stripe returns to a
  different origin). (2) Gmail is restricted, not merely sensitive, and must not block launch; verified.
  (3) The first real action becomes a playable preview before payment, with real contact after activation.
- **Cursor Astra:** prove it with five independent businesses; one recurring job first; measure return before
  building another neighbourhood. Adopted. Its objection that the neighbourhood must not be Claire's *only*
  world model is accepted: the board is one projection of the business record. Understanding why work is
  skipped comes before making the world look worse; the board reflects real consequences such as a customer
  going quiet, never fictional decay from a skipped task.
