# Prototype: "The Friday That Didn't Exist" (clockwork courier)

A proposed game design, not story canon, and not part of onboarding (Adam's brief, 2026-10-30). It tests whether a
small mechanical world is enjoyable to work, and whether THEN and NOW are both needed to solve it. It is built to be
revised or thrown away cheaply. It is not wired into the first ten minutes or slice 8.

## The machine

```
            P ───────── H
             │           │
S ────────── J ────────── Q
```

- **S**: studio, start and finish. **J**: rotating junction. **P**, **Q**: docking pads. **H**: the hotel, a bend
  where the invitation is delivered.
- **THEN** has S–J, J–P and J–Q, and no hotel tracks. **NOW** has P–H and H–Q; THEN's tracks are withdrawn and only
  their outlines show.
- **J** joins west–north (S and P), west–east (S and Q) or north–east (P and Q). It starts at north–east, which
  doesn't admit the courier from S.
- **Docking.** The pads stay put while the layers slide beneath them. The courier stops at P and Q. Layers change
  only while it's docked, and changing them never moves it. The junction turns whenever the courier isn't running.
- **Both circuits complete it.** Clockwise is S→J→P, NOW, P→H→Q, THEN, turn J, Q→J→S. Counterclockwise is the mirror.
- **Failures.** All are quick and recoverable with "Retry the last leg", which keeps the delivery and the configuration:
  - the wrong junction from S: a nose bump, and the envelope flips upright;
  - a release on a layer with no track from that pad: the wheels spin, and the courier settles back on its pad;
  - a return through an unturned junction: the courier stops, and a bell rings once.
- **Rook** speaks at most twice: at the first failure ("A bold interpretation of ‘connected.’") and at success.
- **Nina's sample letters** are labelled as invented: THEN (Elena's April request and Nina's reply) and NOW (Nina's
  September Friday delivery). The puzzle state and the sample choice are stored separately in the browser. "Go
  straight to the correspondence" opens the writing desk without playing. `#neutral` plays the same machine with plain
  labels and no letters.

## The ending

Revised after Adam played the first version and won (2026-10-30). That version's whole payoff was one Rook line and
the old letter appearing below the board. This one was proposed to him first, and he approved it with his changes.
A tap moves it along at any point. With reduced motion, each step is a plain fade.

1. **Homecoming.** The courier docks at the studio and the controls lock. THEN and NOW show together for once: the
   hotel bend appears faintly, and the round trip the courier actually made lights up as one line. A brass chime
   plays, a postmark lands inside the loop (DELIVERED · RETURNED), and Rook says his success line, his second and
   last.
2. **Chapter complete.** CHAPTER COMPLETE, and the title corrects itself in red ink: "Didn't" is struck out and
   "Does" written in. The player has made Friday possible. It is kept brief.
3. **The hotel.** The table leans in to the hotel, and the envelope the courier left there opens where it lies. It
   does not travel: what follows are different objects.
4. **The writing desk.** The studio's own three dated papers land in order:
   - Apr 18, Elena's request;
   - Apr 19, Nina's "Ask me again once we have a Friday delivery.", underlined in red ink;
   - Sep 3, Nina's "weekly Friday delivery", underlined.

   A red thread runs from the promise to the fact. **Nobody explains it**: there is no line telling the player what
   they are looking at. The papers and the choice fit on a phone without scrolling.
5. **The choice.** Prepare a reply, Keep for later, or Not for me, with "Invented sample · this prototype can't send
   anything."
   - **Prepare a reply** writes out the labelled sample on the studio's letterhead, stamped SAMPLE · NOT SENT, then:
     "In JOYSTICK, this is your real reply to your real customer. It opens in your own Gmail, and you decide whether
     to send it." Nothing here can send anything.
   - **Keep for later:** "The letter waits on the table, folded."
   - **Not for me:** "The card goes into the drawer."

   The choice is remembered and never asked again in that round; "Play again" starts a new round. The plain version
   ends at step 2 with "Delivered, and home.", so the win is the same with or without the letters.

## Decided for production (Adam, 2026-10-30), for slice 8

- **Prepare a reply** goes to the real, verified customer conversation and the existing hand-off: the writing table,
  then the send desk (their own Gmail, "Did it go?", the Sent folder). The player decides whether to send it.
- **Keep for later** is today's "Not now": unsent, and it can be brought back.
- **Not for me** is new in production and must be real:
  - it records the decision and closes this opportunity;
  - the player is never prompted about it again, and keeps their fictional victory;
  - the rest of JOYSTICK stays open.

  It is **not** "do not contact": it doesn't block Elena, and it doesn't hide her other mail or any unrelated
  customer activity.
- **No explanatory line** in production either. Besides explaining the mystery the player just solved, "nobody told
  her" asserts something the real records may not prove.

## Code

`client/src/pages/prototypes/fridayCircuit/`:

- `model.ts`: the pure machine, with tests in `model.test.ts`.
- `geometry.ts`: the tabletop.
- `FridayCircuit.tsx` and `fridayCircuit.module.css`: the page and the ending on the board.
- `Desk.tsx` and `desk.module.css`: the writing desk, the choice and what it leaves.
- `sample.ts`: Nina's invented texts.

## Run it

- **Development:** `/prototypes/friday-circuit` in a development build (`pnpm dev`). It is compiled out of
  production.
- **As one page:** `node scripts/prototypes/build-friday-circuit.mjs tmp/friday-circuit` writes a self-contained
  page. Open `tmp/friday-circuit/friday-circuit.local.html` in any browser; no server is needed.
- **Checks:** `pnpm exec vitest run client/src/pages/prototypes` and
  `pnpm exec playwright test --config playwright.prototypes.config.ts` (desktop and Pixel 7). The second also records
  the demos into `tmp/prototypes-results` (`fridayCircuit.demo.spec.ts` on desktop, `fridayCircuit.phone.demo.spec.ts`
  at phone size), with `demo-marks.json` noting when each run's last leg home began, for trimming.

## Not proven by any of this

Passing checks says the machine works as specified. It doesn't say whether it's fun. Still open, the first above all:

- **Does the player recognize the missed Friday opportunity without anyone explaining it?** If yes, the ending works.
- Do players experiment after their first failure?
- Do they understand the layers by playing?
- Is turning the junction back for the return a satisfying realization, or needless fiddling?
- Do Nina's letters make the finished circuit more meaningful? Compare it with `#neutral`.
