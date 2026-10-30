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
  September Friday delivery). Winning opens the invitation with three choices: Prepare a reply (a labelled sample
  draft only), Keep for later, or Not for me. The puzzle state and the sample choice are stored separately in the
  browser. "Go straight to the correspondence" opens the letters without playing. `#neutral` plays the same machine
  with plain labels and no letters.

## Code

`client/src/pages/prototypes/fridayCircuit/`:

- `model.ts`: the pure machine, with tests in `model.test.ts`.
- `geometry.ts`: the tabletop.
- `FridayCircuit.tsx` and `fridayCircuit.module.css`: the page.
- `sample.ts`: Nina's invented texts.

## Run it

- **Development:** `/prototypes/friday-circuit` in a development build (`pnpm dev`). It is compiled out of
  production.
- **As one page:** `node scripts/prototypes/build-friday-circuit.mjs tmp/friday-circuit` writes a self-contained
  page. Open `tmp/friday-circuit/friday-circuit.local.html` in any browser; no server is needed.
- **Checks:** `pnpm exec vitest run client/src/pages/prototypes` and
  `pnpm exec playwright test --config playwright.prototypes.config.ts` (desktop and Pixel 7). The second also
  records the demo video into `tmp/prototypes-results`.

## Not proven by any of this

Passing checks says the machine works as specified. It doesn't say whether it's fun. Still open:

- Do players experiment after their first failure?
- Do they understand the layers by playing?
- Is turning the junction back for the return a satisfying realization, or needless fiddling?
- Do Nina's letters make the finished circuit more meaningful? Compare it with `#neutral`.
