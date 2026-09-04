# Goldline Visual & Motion Rulebook

**Status:** canon. The enforceable half lives in `shared/goldlineVisualCanon.ts`
and fails the build when violated. This document carries what a test cannot:
the reasoning, the image-generation prompts, and the acceptance checklist.

This does **not** restate `WORLD_BIBLE.md` §3, which already sets the
presentation law — cinematic character-forward action-adventure, the phone as a
camera into a larger stage, never a flat 2D game board. That remains canon. This
covers what the bible predates: the daylight reversal, and the window states the
real business drives.

---

## 1. Daylight is not a preference

The operator works out of a van in Los Angeles sun. A dark screen there is not a
taste question — it is unreadable, and an unreadable tool stops being opened.
That is the whole argument, and it outranks any aesthetic case for a dark map.

**Dark text and dark shadows stay.** They are what makes a bright surface legible
outdoors. It is dark *grounds* that are banned.

Palette tokens are defined once in `DAYLIGHT_PALETTE` and asserted against the
stylesheet, so the CSS and this rulebook cannot drift apart.

| Token | Role |
|---|---|
| `--lc-day-sky` | Upper ground of the city surface |
| `--lc-day-ground` | Lower ground, warm |
| `--lc-day-ink` | Primary text. Deliberately dark. |
| `--lc-day-ink-muted` | Secondary text |
| `--lc-day-label` | Paper plates behind building labels |
| `--lc-day-edge` | Hairline borders |
| `--lc-window-gold` | Window shimmer on active customers |
| `--lc-ribbon-gold` | The transient outreach ribbon |
| `--lc-panel` | Floating chips and alert panels |

---

## 2. Dormancy is quiet, not dark

A dormant building is **never unlit**. It stays sunlit and cream. What it loses
is the golden shimmer in its windows and its gentle motion.

Darkening it would say *abandoned*. Going quiet says *nobody has ordered from
here lately* — which is both true and far more actionable.

| State | Reading | Earned by |
|---|---|---|
| **Warm** | Windows shimmer; gentle activity | Order evidence |
| **Quiet** | Sunlit, still, no shimmer | Lapsed cadence |
| **Stirring** | Quiet **plus** a brief gold ribbon | Attested outreach — still dormant |
| **Unknown** | Flat, no shimmer, excluded from the lit share | No order history |

**The one rule that matters:** a dormant customer cannot reach warmth through
outreach alone. Warmth means *active*, and an ordinary customer who never lapsed
is already warm — most warm windows in a healthy city belong to people nobody
had to win back.

Mixed buildings are the normal case. Lit windows are proportional to the active
share; one dormant resident must never darken a tower.

---

## 3. Motion

Compositor-only: `opacity`, `transform`, `filter`. These pages animate
continuously on a phone in a van, and anything that triggers layout or paint per
frame drops frames on exactly the hardware the operator actually has.

- Ambient loops ≥ 2000ms — life, not alarm.
- Reactions to real events ≤ 1200ms.
- Every animation needs a reduced-motion fallback **that loses no meaning**. The
  plain-language status line carries the state independently, which is why the
  ribbon can degrade to a static tint without hiding anything.

Two pre-existing violations are recorded in `KNOWN_MOTION_EXCEPTIONS` rather than
silently rewritten: `lc-reignite` animates `box-shadow` (repaint per frame) and
`lc-tether-pull` animates `height` (layout per frame). The test ratchets — these
may remain, nothing new may join them.

---

## 4. Forbidden patterns

1. **No dark background on a designated daylight surface.**
2. **Never light a window on outreach alone.** Sending is an action, not an outcome.
3. **Colour or motion is never the only channel.** A plain-language status always accompanies it.
4. **Never zoom out until the whole level fits.** (WORLD_BIBLE §3)
5. **A paused frame must not read as a flat 2D game board.** (WORLD_BIBLE §3)
6. **A dormant building is never unlit, only unshimmering.**

---

## 5. Image-generation prompts

Reusable. Keep the stem identical across assets — consistency of style beats
fidelity of any single asset, and a mixed-style set reads as cheap however good
the individual pieces are.

**Stem (prepend to every prompt):**

> Painterly cinematic illustration, warm Los Angeles midday light, high sun, dry
> golden haze. Grounded realism with heightened colour. Deep shadows and strong
> contrast, but never a dark overall image. Vertical composition that extends
> beyond frame. No text, no UI, no logos, no watermark.

**City ground (replaces the night satellite map):**

> …aerial three-quarter view of a Los Angeles district at midday, cream and sand
> rooftops, palm shadows falling long across pale streets, hazy blue-white sky at
> the horizon. Buildings legible as individual structures. Bleached warm palette.

**A tower, active:**

> …a single mid-rise residential tower in full midday sun, warm cream and sand
> facade, windows catching gold, awnings out, subtle signs of life. Confident and
> cared-for. Isolated on transparent background.

**A tower, dormant (same building, same angle, same light):**

> …the identical tower in the identical midday light, still fully sunlit and
> cream — not dark, not night. Windows flat and unreflective, no gold, awnings
> retracted, no movement. The stillness is the only difference.

**Clockhead:**

> …a towering bronze and stone figure whose head is an astronomical clock
> mechanism, concentric moving rings, some faces with no hands. Reads instantly
> as a clock at silhouette scale. Backlit by high sun, warm bronze against pale
> sky. Imposing, patient, unbothered.

---

## 6. Asset acceptance checklist

Reject an asset that fails any line. Rejection criteria are the point — drift is
what kills a set, and drift enters one "close enough" asset at a time.

- [ ] Reads as **daytime**. No night, dusk, or neon-on-black.
- [ ] Overall image is light; darkness appears only as shadow and contrast.
- [ ] Palette sits inside the daylight tokens — cream, sand, warm gold, pale sky.
- [ ] Silhouette is readable at 40px on a phone.
- [ ] Style matches the existing set: same rendering, same light, same saturation.
- [ ] Extends beyond the frame; does not read as a self-contained flat tile.
- [ ] No baked-in text, UI, numbers, or logos.
- [ ] For paired states: **identical** angle, light and framing — only vitality differs.
- [ ] Transparent background where the asset composites onto the world.
- [ ] A paused frame including it does not read as a 2D fantasy game board.

---

## 7. What this rulebook cannot check

A stylesheet test cannot see imagery, gradients, or overlays. Three surfaces
currently still read dark and **none of them are CSS**:

- the satellite map image (a night aerial photo — needs the §5 city-ground asset),
- the OPUS LA tower's purple neon art,
- the global admin nav shell (CSS, but outside the city's approved scope).

Rendered screenshots at 390×844 and desktop are the acceptance evidence for
these, not the guard.
