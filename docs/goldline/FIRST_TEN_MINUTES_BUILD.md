# JOYSTICK's first ten minutes: the build

**This document constrains future first-ten-minutes work. Current production/main outranks prose.**

Astra's proposal (parts 1 to 3), built as written, in the presentation Adam asked for on 2026-10-29. Where Astra was
specific, the code follows her words; where she was silent, the decision is recorded here. `FIRST_TEN_MINUTES.md`
(2026-10-25) describes today's funnel; where the two differ, this build follows Astra.

## Presentation rules (binding)

- **The person's own life is the spectacle.** Their words, people, routes and requests are the largest and most
  beautiful things on screen, on tactile stationery. The most emotionally significant thing on screen is theirs.
- **The crew interrupts; it is never introduced.** Characters are small, stay at the edges, and get one short line
  each, with comic timing.
- **No landing-page grammar:** no marketing headline, comparison cards, CTA-dominated layout, cast directory, step
  counter, characters posing around copy, or captions explaining the magic.
- Sable: magenta masked fox or raccoon, yellow jacket, notebook. Mara: orange fox, blue work jacket and beanie, map.
  Rook: green bird, red white-spotted mushroom beak, camo bucket hat, goggles, wind-up key, satchel, envelopes.

## Turning it on

One flag, `JOYSTICK_FIRST_TEN_MINUTES` on the Railway `bldg-admin-api` service:

| Value | Effect |
|---|---|
| unset (default) or anything else | Off. `/joystick-start` is today's funnel, as before (after one availability check); every `system.firstTenMinutes.*` procedure but `availability` refuses; the OAuth callbacks send visitors to `/joystick-start`. Nothing stored is deleted. |
| `preview` | Only a browser that opened `/joystick-start?crew=1` sees it (remembered for that tab, and for a draft started there). For trying it in production while Google lists the app in Testing mode. |
| `on` | Everyone who opens `/joystick-start` sees it. |

A Stripe return for a draft that belongs to today's funnel always lands on today's page, whatever the flag says.

## What Adam sets (nothing here is set by an agent)

### Railway → `bldg-admin-api` → production → Variables

| Variable | Value |
|---|---|
| `JOYSTICK_FIRST_TEN_MINUTES` | `preview` to try it (`/joystick-start?crew=1`), `on` to launch |
| `JOYSTICK_GOOGLE_CLIENT_ID` | from the Google OAuth client below |
| `JOYSTICK_GOOGLE_CLIENT_SECRET` | from the Google OAuth client below |
| `JOYSTICK_SLACK_CLIENT_ID` | from the Slack app below (optional: without it, "Add Slack" is disabled) |
| `JOYSTICK_SLACK_CLIENT_SECRET` | from the Slack app below |
| `JOYSTICK_CONNECTION_TOKEN_KEY` | a new random secret (`openssl rand -base64 48`). Encrypts stored Google/Slack tokens. If unset, `JWT_SECRET` is used; set it once and never change it, or stored connections stop decrypting. |
| `JOYSTICK_FIRST_TEN_ORIGINS` | optional: extra `https://` origins allowed to start a connection (comma-separated) |

`JWT_SECRET` (signs the connection state) must already be set.

### Google Cloud console (the project that owns JOYSTICK's OAuth)

1. **APIs & Services → Library**: enable **Gmail API**, **Google Calendar API**, **Google Drive API**.
2. **Google Auth Platform → Branding**: app name JOYSTICK, support email, app home page `https://gojoystick.com`,
   privacy policy and terms URLs, authorised domains `gojoystick.com` and `bldg.chat`.
3. **Audience**: External, **Testing**. Add each test user (up to 100): Adam's Google account and the pilot owners.
   Test users see Google's "unverified app" screen; everyone else is blocked until verification.
4. **Data Access → Add or remove scopes**: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`,
   `.../auth/gmail.readonly`, `.../auth/calendar.readonly`, `.../auth/drive.readonly`. Nothing else.
5. **Clients → Create client → Web application** ("JOYSTICK first ten minutes"). Authorised redirect URIs:
   - `https://gojoystick.com/api/first-ten/oauth/google/callback`
   - `https://admin.bldg.chat/api/first-ten/oauth/google/callback`
   - `https://admin.gojoystick.com/api/first-ten/oauth/google/callback`
   - `https://app.gojoystick.com/api/first-ten/oauth/google/callback`

   Copy the client ID and secret into Railway.
6. **Before a public launch**: Verification Center → submit. Gmail and Drive read access are *restricted* scopes:
   Google requires a privacy policy that covers Google user data and its Limited Use, a demo video of the consent
   flow, and a CASA (Tier 2) security assessment by an approved assessor, renewed yearly.

### Billing (for "Continue with JOYSTICK"; nothing here is set by an agent)

The first ten minutes use today's JOYSTICK billing as it stands. Until these are set, the card says plainly that
JOYSTICK isn't taking payment yet, and nothing is charged. On Railway → `bldg-admin-api` → production → Variables:

- `DAYFORGE_BILLING_STRIPE_SECRET_KEY` (legacy name): today's checkout opens only with a Stripe **test** key (`sk_test_…`); live
  keys stay refused until `docs/JOYSTICK-SAAS-LAUNCH-OPS.md` is done.
- `DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET` (legacy name): the signing secret of a Stripe webhook endpoint at
  `https://admin.bldg.chat/api/dayforge/billing/stripe-webhook` (legacy path; event `checkout.session.completed` and the
  subscription events today's billing handles).
- `DAYFORGE_STRIPE_PRICE_ID`, `DAYFORGE_STRIPE_PLAN_KEY=joystick-growth-standard`, `DAYFORGE_STRIPE_TRIAL_DAYS=7` (legacy names): the
  monthly plan the card states ($49 a month, seven days free). Full steps are in
  `docs/legacy-dayforge-saas-onboarding-billing.md` and `docs/legacy-dayforge-production-rollout.md`.
- `DAYFORGE_BILLING_APP_URL` (legacy name): leave unset (checkout returns to `admin.bldg.chat`). A journey begun on another origin
  is carried there before checkout.

### Slack (api.slack.com/apps)

1. **Create New App → From scratch**, name JOYSTICK.
2. **OAuth & Permissions → Redirect URLs**: the same four origins with `/api/first-ten/oauth/slack/callback`.
3. **User Token Scopes** (no bot scopes): `channels:read`, `channels:history`, `groups:read`, `groups:history`,
   `im:read`, `im:history`, `mpim:read`, `mpim:history`, `users:read`, `search:read`.
4. **Manage Distribution → Activate Public Distribution**, so owners outside Adam's workspace can add it.
5. **Basic Information → App Credentials**: client ID and secret into Railway.

## How it is built

| Piece | Where |
|---|---|
| Contracts (flag, scopes, "what connecting includes", journey shape) | `shared/firstTenMinutes.ts` |
| Nina's labelled example | `shared/firstTenMinutesExample.ts` |
| Server | `server/firstTenMinutes/` (`router.ts` is `system.firstTenMinutes`, `oauthRoutes.ts` the callbacks) |
| Tables | `drizzle/0152_first_ten_journeys.sql` (journeys, connections), `drizzle/0153_first_ten_findings.sql` (readings, findings), applied by `scripts/migrate.mjs` |
| The example's invented sources and readings | `shared/firstTenMinutesExampleCorpus.json`, `shared/firstTenMinutesExampleExtraction.json` |
| Page | `client/src/pages/firstTenMinutes/`, mounted at `/joystick-start` by `JoystickStartRoute.tsx` |
| End to end | `scripts/first-ten-e2e.sh`, `e2e/first-ten-minutes/`, CI workflow `first-ten-minutes.yml` |

**Journeys.** Each visit is a signup draft (the legacy `dayforge_saas_onboarding_sessions` table, mode `joystick_first_ten`, 14-day
expiry) with one journey. Its resume token stays in the starting origin's browser storage under its own key, so it
never mixes with today's funnel. Google, Slack and Stripe all return to that origin.

**Connections.** Read-only Google (Gmail, Calendar, Drive) and Slack (user token). The consent URL comes from a
mutation that records the start origin and sets a ten-minute HttpOnly nonce cookie; the callback requires the signed
state, the same browser's nonce, and a known origin, then stores the tokens encrypted (AES-256-GCM). Google without
Gmail is revoked and refused, plainly. Disconnecting revokes at the provider (best effort) and deletes the copy either
way. The callback never echoes a code, token or provider message.

**The example.** "Explore an example" is Nina's flower studio, invented, on the reserved `.example` domain, labelled
on every screen ("Example: Nina's flower studio, invented. Nothing here is yours.") with "Bring your own" one tap
away. It cannot connect accounts, and (later slices) cannot activate or send.

## The crew's reading (slice 2)

`server/firstTenMinutes/understanding/`. One reading per journey, in this server process, in three stages. Each
stage's line is shown only while that work runs:

| Stage | Line (Astra's) | The work |
|---|---|---|
| `people` | Meeting the people you write to. | Sent and received Gmail (last twelve months, at most 160 sent and 240 received). The person's own name, people by correspondence, Rook's habit (how the person ends their own mail), Luma's image (a picture attached to two or more sent messages). No model. |
| `conversations` | Following the conversations you keep coming back to. | One Claude call over the person's own mail and mail from people they write to: the business, rules, promises, requests, replies, services, places, a contrast between two kinds of request. |
| `work` | Finding the work already in motion. | Calendar (last 90 days, next 30), Drive (recent files, the text of up to 12 documents), Slack (the person's own messages and messages to them, last 90 days). Orren's route (a weekday the calendar repeats, with places), the week's rhythms (one-off events that keep landing on the same days), a second Claude call over documents and Slack, coordinates for places and stops, and Ilex's opportunity. |

**What the model may do.** It proposes; `extract.ts` decides. Every item cites its source and copies the exact words.
An item is dropped when the words aren't in that source (case, curly quotes and spacing aside), or when it comes from
the wrong person: a rule or service the owner didn't write, a request the owner made, a reply that doesn't answer the
person who asked. A contrast line with a number is dropped. Dates and people always come from the item itself. What is
shown is the source's own characters, never the model's copy.

**Opportunities.** Kept only when the chain holds in the verified findings: someone asked, the person declined and
said what was missing, and a later service offers it (`became_possible`), whoever proposed it. The model's proposals
are checked against the same chain. Ranked by type, then whether the person's route meets the asker's place (same
street, or a stop within 600 m), then whether the place is known. Never a travel time.

**What is kept.** Findings with short quotes and their sources (`first_ten_findings`), and the reading's progress
(`first_ten_readings`, migration 0153). Not the person's mail, calendar or files. Where an image's bytes live (a Gmail
attachment id) is kept server-side only, to show the person their own picture later.

**When things fail.** A source that can't be read is left out and the reading carries on. A failed model call becomes a
plain note ("Some of your conversations couldn't be read closely just now."), and the reading finishes with what it
could count. A reading whose server went away shows as failed and can be started again; finding ids are stable per
journey, so nothing the person said about a finding is lost.

**AI spend** is attributed per journey (`first_ten:<journey id>`), under the default per-tenant limits
(`AI_WARNING_LIMIT_CENTS`, `AI_HARD_LIMIT_CENTS`). A reading makes two calls.

**Configuration.** `ANTHROPIC_API_KEY` (already set for Claire). For pins on Mara's map and Orren's route,
`GOOGLE_GEOCODING_API_KEY` or `GOOGLE_PLACES_API_KEY` (already used by the geocoder); without either, places keep their
names and no pins.

## The crew gets acquainted (slice 3)

`shared/firstTenMinutesCrew.ts` decides who speaks and what they point at; `client/src/pages/firstTenMinutes/crew/`
stages it. The desk starts nearly empty: one thing the person wrote, on stationery. The crew enters at the edges, one
short line each, in this order, and nobody is introduced:

| Who | Object | Line |
|---|---|---|
| Sable | A rule the person wrote (or, failing that, a promise) | "Still true?" ("Still on?" for a promise) |
| Mara | The places on a small map, each with who asked and when | "That's a small map with quite a lot happening on it." |
| Rook | Strips of how the person ends their own messages | "You tend to finish with a real question." / "I can work with that." |
| Bront | Two kinds of request, side by side | the contrast, in two lines |
| Luma | The picture the person keeps attaching | "This one keeps coming back. Three proposals. Same blue jug." / "I've kept the original." |
| Orren | The person's repeating route, drawn onto Mara's map | "Your Friday deliveries already pass this street." |
| Ilex | The older conversation the opportunity hangs on, threaded to its place | "There's an older conversation we should put beside this." |

A companion with nothing to reveal waits; nothing says so. Mara, Orren and Ilex need the whole reading (places,
route, opportunity), so they come once it has finished.

**Sable's question persists and changes the world.** "Still the rule" marks the rule confirmed; "That's changed"
keeps the person's new words and crosses the old ones out. Either answer is stored on the finding and appended to
`first_ten_events` (migration 0154). `suggestionRules` turns confirmed rules into what later suggestions must respect
(closed days, the rule's own words), and the week above the desk folds Sunday closed. A reload keeps it.

**Every object opens to its source** (who, when, the exact words) and can be corrected: "It changed" (with what's true
now) or "That's not right". A corrected object greys and moves to the side of the desk, its companion answers in one
word or two ("Struck."), and it is never revealed again.

**Pictures.** The example shows a painted stand-in. For a real account, the person's own attachment is fetched from
Gmail when it is shown (at most 4 MB) and never stored.

## Claire's portrait (slice 4)

When the crew has had its say, the scene settles and one page appears: Claire's portrait of the person's working life,
signed in her hand. It opens with Astra's greeting ("Nina, here's where you are."), and ends with "There's one I'd like
to show you." only when the reading found an opportunity. Two quiet answers sit under it: **That sounds like me** and
**Let me change something**. There is no share option yet.

**How it's written.** `server/firstTenMinutes/portrait/`. For a real account, one Claude call writes two or three short
paragraphs from the findings still standing, with the person's corrections as the truth; each sentence cites the
findings it rests on. The server then strikes any line that:

- names a person, place, day, month, number or quotation those findings don't hold,
- cites a finding that isn't there, or
- mentions the machinery (JOYSTICK, Claire, the crew, AI).

A page with fewer than two lines left isn't shown at all, and the journey carries on without it. Nina's example is
Astra's page word for word, each line tied to her invented records; a changed Sunday rule changes its line.

Two findings were added to the reading for this: the person's own name (the name their mail goes out under, never their
business's) and a rhythm (one-off events that keep landing on the same days, such as Nina's five Saturday weddings).

**Changing it.** "Let me change something" makes each line touchable. A line opens to where it came from; the
person's words then stand on the page in their own hand beside Claire's struck line. They can take a line out, or put
Claire's back.

**Keeping it.** "That sounds like me" keeps the page with the changes; Claire's seal is pressed beside her name, and
the journey moves on. The page is stored in `first_ten_portraits` (migration 0155). It is written again only while
not yet kept and only when what it rests on changes. Every change and the keep are appended to `first_ten_events`.

**AI spend:** one call per page, attributed per journey like the reading.

## The revelation and "A Proper Letter" (slice 5)

Once the person keeps Claire's page, the first chapter begins. It is built on the strongest opportunity still standing
and the findings it rests on (`server/firstTenMinutes/chapter/`): the request, the person's reply, what they offer now,
their route and the place.

**The revelation, played rather than announced.** A desk calendar turns back to the month they were asked. Elena's
request is pinned on the day, with Nina's reply beneath it, in their own words. On Mara's map the crossing from the
route to the hotel is folded shut, with its sign ("FRIDAY — UNAVAILABLE"), and Rook tries it: "Well, that's
inconvenient." The person turns the calendar to today, where their own announcement of the Friday delivery is pinned
and Orren's route is drawn. They bring the invitation onto today's map (drag it, or tap it) and the crossing unfolds.
Rook: "Oh. Well, look at that." Nobody explains it. A quiet "Why?" opens the full explanation with its sources (Astra's
"Someone already asked for what you now offer."), and "Pick up the story" leads on.

**"A Proper Letter".** The Silver Lake courtyard, from its painting, with Hazel's errand from the courtyard game
(`reunionQuests.ts`, "squirrel_hoa_letter"): its steps, their order (`applyStepItem`) and their lines as written there,
opened and closed with Astra's lines.

- Hazel: "A letter? Excellent. I have several opinions about letters." / "Mine requires a proper response. In ink.
  With a quill." Rook: "You have a pen." Hazel: "I said proper."
- Pip shaken bare-handed says ow, and Sable offers "Thick. Knitted. Currently protecting a teapot." She also offers it
  if the player is stuck.
- The tea cosy becomes an oversized glove, Pip shivers, a quill floats down, and the ink lands on Hazel's complaint.
- Hazel reads the player's reply, straightens it and stamps it: "Complaint withdrawn." / "I'm keeping the stamp." /
  "Now. Yours."

The player carries the unfinished conversation as a folded card in their pocket. The 3D courtyard itself is for
signed-in operators and needs WebGL, so this chapter is a 2D stage on the onboarding page. The props are drawn by
hand; Hazel and Pip are the courtyard's own art.

**The writing table, for real.** The same table becomes the place where the real message is prepared:

- The boundary is plain: "Your business · Elena at the hotel".
- The old request and reply sit beside what Nina offers now.
- The real recipient and the exact message are on view: To: Elena Ruiz <elena@larkspurhotel.example>, Re: Friday
  flowers?, "Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery. Is that
  still something you're looking for at the hotel?"
- Rook: "Short enough to answer."

The draft is composed only from the findings, with no model call. The person can edit it, "Try another way" (offer to
start; keep it short), or say "Not now", which keeps it unsent and lets them bring it back. Nothing is sent from here.
The message claims only what is on record:

- **No service on record.** There is nothing new to offer, so the message only picks the conversation up. If the request
  was never answered, it says so ("and I never got back to you"). The only ways it can go are to ask, or to ask briefly.
- **The crossing's sign.** It reads "FRIDAY — UNAVAILABLE" only when the reply named something that was missing.
The draft is stored in `first_ten_drafts` (migration 0156), whose hand-off columns stay empty until the next slice. Each
beat of the chapter is appended to `first_ten_events`, so a reload carries on where the person left off.

## Keeping the crew, and the message leaving the table (slice 6)

At the writing table, once the message has value, the person can keep their crew. The card says "Keep your crew.
Continue your story." and "Your business portrait, this conversation, and everything you've prepared will be waiting
here." It then states the actual offer plainly, from the live plan: "7 days free, then $49 a month. Card required. One
plan. Cancel anytime." for `joystick-growth-standard`. What JOYSTICK already knows (business, name, email) is shown for
the person to confirm, and "Continue with JOYSTICK" leads to checkout.

- **Checkout is today's** (`server/saas`), on the journey's own signup draft. Changes to billing code:
  - A first-ten draft takes its identity without the prepay questions (`saveFirstTenOnboardingIdentity`).
  - It counts as ready for checkout and for provisioning by the same rule as a JOYSTICK signup.
  - Stripe returns it to `/joystick-start`.
  - The webhook provisions the workspace exactly as for any JOYSTICK signup, minus seeding the prepay answers it
    doesn't have, and the journey records its tenant.
- **The return lands on the prepared message.** The draft, the scene and every decision live on the server, so
  they survive checkout. A cancelled checkout says "Checkout closed. Nothing was charged; everything here is saved."
- **One origin.** Today's checkout returns to one origin (the legacy-named `DAYFORGE_BILLING_APP_URL`, default `admin.bldg.chat`), while a
  draft's credentials live in the browser on the origin where it began. A journey begun elsewhere is carried to the
  return origin first: "Continue on admin.bldg.chat" moves its credentials in the URL fragment, which no server ever
  sees, and the page there adopts them and clears the fragment.
- **No billing plan, no paywall.** Without a plan (production today) the card says "JOYSTICK isn't taking payment
  yet. Everything here is saved." and the message can still leave. With a plan, it leaves only once the journey is
  active.
- **Nina's example** never activates and never sends.

**The message leaves the person's way.** "Your message to Elena opens in your own Gmail, ready to send. You send it
there. JOYSTICK doesn't send it." Behind it:

- **Open in Gmail.** Gmail's own compose window opens with the real recipient, subject and exact text (`authuser`
  picks the connected account). The person can also copy the message.
- **What is recorded.** Only what is known: that the message was opened in their mail ("Opened in your mail at 3:42
  PM. JOYSTICK didn't send it."), and what they answer to "Did it go?" ("I sent it" / "Not yet").
- **What their Sent folder shows.** On their return, and every little while, JOYSTICK looks in their own Sent folder
  for a message to the recipient since the hand-off, using the read-only Gmail access they gave. "In your Sent
  folder, 3:44 PM." appears only when it is there.
- **Never "sent" unless it was.** The draft's status, and the times it left, was reported and was found, are kept
  in `first_ten_drafts`, and every step is in `first_ten_events`.

**The closing beat answers what actually happened**, in the courtyard:

- **Sent**, by their word or by their Sent folder: "Hazel notices the ink on your hand." / "You'll get used to that."
- **Not yet:** "It'll keep. Ink does."
- **Not now:** "Some letters are better kept."

Each time, "Pip retrieves the tea cosy and settles underneath it."

## Your first chapter (slice 7)

"Back to your page" sits under the writing table once there is a draft, and returns the person to Claire's portrait,
kept as they left it. A new entry has appeared on the page:

- **"Your first chapter"**, then Astra's entry, written from what the person actually did: "You revisited Elena's
  Friday request and prepared a reply using the weekly service you now offer." If they decided it could wait, it says
  that instead.
- **The message's actual status**, the same line the writing table shows ("Prepared. Not sent.", "Opened in your
  mail at 3:42 PM. JOYSTICK didn't send it.", "In your Sent folder, 3:44 PM.").

**Claire is available with a suggested question**: "Where did we leave things with Elena?". Her answer is composed from
the records, not generated, so it is exact:

- **The request:** "You picked up Elena's Friday request from April."
- **The message as it stands:** kept as drafted, the version they chose, or put in their own words, quoted in full.
- **Where it is now, and only what is known.** Before answering she looks in their Sent folder again. She says a
  message isn't there only when she looked; if she couldn't, she says that instead.
- **Whether the recipient has written back since.** This is read from their own mail with the read-only access they
  already gave, quoted verbatim past the greeting.
- **Times are given in the person's own time zone, or not at all.**

The answer is kept (`claire_answered` in `first_ten_events`), so she remembers what she said after a reload. "Ask again"
answers from the records as they are then. "Tomorrow, we'll pick up from here." follows her answer. "The courtyard"
returns to the writing table and the closing beat, and no list of chores appears anywhere. The journey's stage is
`first_chapter` from the person's first return.

## Slices

| # | Slice | State |
|---|---|---|
| 1 | Connect: Google and Slack OAuth, what connecting includes, the labelled example | merged |
| 2 | Understanding: the job that reads the sources into sourced findings, progress that tracks the work | merged |
| 3 | The crew gets acquainted: seven reveals, sources on tap, corrections, Sable's confirm changes the world | merged |
| 4 | Claire's portrait: "That sounds like me / Let me change something" | merged |
| 5 | The revelation and "A Proper Letter" in the Silver Lake courtyard, handing off to the real draft | merged |
| 6 | Activation at the moment of value: the draft, scene and decision survive checkout | merged |
| 7 | "Your first chapter": Claire answers "Where did we leave things with Elena?" with the real state | this PR |
| 8 | Part 3: "The Friday That Didn't Exist", "The Estimate That Wouldn't Fit", "Here is what changed because you arrived" | |

## Verification

- `pnpm exec vitest run server/firstTenMinutes shared/firstTenMinutes client/src/pages/firstTenMinutes`
- On a local disposable MySQL (`first_ten_test`): `node scripts/migrate.mjs` twice, then
  `pnpm exec vitest run --config vitest.integration.config.ts server/firstTenMinutes`
- `scripts/first-ten-e2e.sh`: the real server and page, Google and Slack played locally. Screenshots land in
  `tmp/first-ten-e2e-shots/`.

Not verifiable here: real Google and Slack consent screens and tokens (they need the production clients above), and
anything on production Railway.
