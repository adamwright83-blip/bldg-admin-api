# JOYSTICK BRAND CANON — LOCKED 2026-09-17

**Status: LOCKED. Do not redesign, reinterpret, or “improve” the logo or brand-visibility architecture without Adam explicitly reopening the decision.**

This file records the approved Joystick brand direction after the 2026-09-17 concept exploration. If later prose conflicts with the approved visual or visibility rules below, **this canon wins**.

## Brand

**Name:** Joystick

**Primary tagline:** `REAL WORK. PLAYABLE.`

Joystick is the **external company/platform brand**, not the persistent in-product game brand.

Goldline may remain an internal/product-system term in the existing codebase until an explicit rename/migration project is approved. Do not opportunistically rename code, routes, schemas, or docs just because the external company brand is Joystick.

## Brand architecture — platform first, game thereafter

This distinction is binding:

### Joystick owns

- company identity
- marketing site
- investor materials
- App Store / Play Store identity
- app icon
- signup / account creation
- first-run onboarding before a game genre is selected
- the mobile launch / splash screen where the platform logo is conventionally shown
- any future neutral surface whose purpose is specifically to choose, switch, purchase, or manage game experiences before entering one

### Joystick does **not** own the persistent product chrome after game selection

Once the user chooses a preferred playable experience / game genre — for example **Goldline**, a basketball-draft game, or another future game — that game becomes the visible identity of the experience.

From that point forward:

- **Desktop:** do not show the Joystick logo in normal product use. After signup / game selection, the chosen game's logo and visual identity own the desktop experience.
- **Mobile:** do not show the Joystick logo inside normal product screens. The sole standing exception is the operating-system/app launch splash screen. Once the app enters the selected game, that game's logo and identity take over.
- Do not place a small Joystick mark in headers, sidebars, footers, settings screens, mission screens, maps, or dashboards merely for corporate-brand consistency.
- Do not co-brand normal gameplay as `Joystick + Goldline` or `Joystick presents Goldline` unless Adam explicitly requests such a campaign treatment.
- Do not watermark game surfaces with Joystick.

**The desired feeling is closer to a game platform/publisher relationship than a SaaS suite.** The player signs up for Joystick, chooses what they want to play, and then experiences the chosen game as its own world.

A user playing Goldline should feel like they are **inside Goldline**, not inside a Joystick SaaS dashboard containing a Goldline module.

Likewise, a future basketball-draft experience should look and feel like that game, not like Goldline reskinned and not like a generic Joystick shell.

### Persistence of game choice

The user's selected game identity should persist across sessions until they deliberately switch experiences.

On launch:

1. OS/app splash may show the Joystick app logo.
2. Resolve the user's selected/default game.
3. Enter that game's branded world immediately.
4. Do not insert a redundant Joystick interstitial between splash and game.

If no game has been selected yet, Joystick-branded onboarding may present the available game choices.

## Approved logo direction

The approved master concept is the **flat 2D version of the joystick/operator mark** from the final 2026-09-17 brand board.

The symbol consists of:

- a **warm amber/orange circular knob/orb** at the top
- a **white J-shaped joystick stem**
- a **dark charcoal rounded-square / rounded-diamond base** with an inset/open center around the lower J
- a flat 2D construction: no photorealistic rendering, no perspective-heavy 3D logo treatment as the master identity
- the bold `Joystick` wordmark paired with the symbol
- `REAL WORK. PLAYABLE.` as the default lockup tagline where a tagline is appropriate

The exact approved proportions, silhouette, spacing, and visual balance should be preserved when the logo is professionally vectorized. **Vectorization is a production cleanup task, not a redesign exercise.**

## Meaning

The symbol works because it can be read as:

- the **operator / pilot** at the controls
- a joystick / control input
- the operating platform or machine underneath the operator
- agency, movement, and real-world action

There is also a private founder-level origin story: the dark base can evoke the vehicle/platform carrying the operator through the real workday while the joystick represents the person driving the work forward. **Do not literalize this into a car, wheels, roads, or transportation iconography.** The abstraction is what lets the same mark belong to a plumber, electrician, laundromat operator, property operator, contractor, or another field-service business.

## Color system

Use the approved board palette as the default **Joystick corporate/platform** brand system:

- **Deep Charcoal** — `#0B0F14`
- **Amber** — `#FF8A00`
- **Gold** — `#FFC84D`
- **White** — `#F8F9FA`

Amber is the primary signal/accent. Deep Charcoal is the control/platform color. White provides the clean structural J/wordmark contrast.

These colors do **not** constrain the color systems of individual games. Goldline and future games are allowed — and encouraged — to have distinct art direction and palettes appropriate to their worlds.

Do not force Joystick amber/charcoal into a game's UI merely to remind the user of the parent brand.

Do not revert the Joystick corporate identity to the earlier blue-purple gradient system unless Adam explicitly reopens the brand decision.

## Core variants to produce

The production identity kit must preserve the same locked mark and include:

1. primary color lockup
2. monochrome black
3. monochrome white
4. standalone symbol
5. app icon
6. mobile launch/splash treatment
7. favicon at 16×16 and 32×32
8. transparent PNG exports
9. clean SVG master files
10. print-safe PDF/EPS equivalent if needed
11. horizontal wordmark + symbol lockup

The monochrome versions must remain recognizable at small size.

## Explicitly rejected directions

Do **not** drift back toward any of these prior explorations:

- person / wellness / meditation silhouette
- car seat / hooded seated-person silhouette
- snail / snake-shaped J
- literal construction-equipment joystick
- generic AI knot / spark / gradient blob
- portal-only J that loses the joystick/operator character
- photorealistic 3D joystick as the core logo
- obvious gamepad / Atari nostalgia
- car / Prius literalism
- wheels, roads, steering wheels, construction machinery
- over-cute mascot face treatment as the master corporate logo

The brand can have playful character extensions later, but they must not replace the locked master mark.

## Usage rule

The Joystick logo should feel modern, investor-ready, playful without being childish, and credible for people doing real work.

Appropriate Joystick-logo surfaces include:

- investor deck cover
- marketing website
- signup / login / first-run platform onboarding
- game-selection surface before entering a game
- App Store / Play Store listing
- mobile app icon
- mobile launch/splash screen
- favicon
- invoice or contract header
- corporate merchandise / equipment case / event material

**Normal authenticated game surfaces are intentionally absent from this list.**

Once a player has entered a game, use that game's logo, iconography, language, palette, characters, and world identity instead.

### Explicit product-logo prohibition

Unless Adam explicitly reopens this rule, do **not** add the Joystick logo to:

- Goldline desktop navigation
- Goldline mobile navigation
- Goldline map / mission HUD
- Goldline settings chrome
- game dashboards
- game headers / footers
- Claire surfaces merely to denote ownership
- future game interfaces after the player has entered that game

A developer should not interpret an empty header corner as a reason to add the Joystick mark.

## Game-brand requirement

Every selectable game genre / playable operating mode needs its own visible identity package sufficient to replace Joystick once entered.

At minimum each game needs:

- game name / wordmark
- game logo or identifying symbol
- game-specific app-internal visual identity
- loading/transition treatment if needed after the Joystick splash
- desktop identity treatment
- mobile identity treatment

The game does not need a separate installable app. Joystick remains the installed app/platform; the selected game supplies the in-app identity.

## Copy hierarchy

For Joystick investor / high-attention contexts, prefer plain positioning over abstract brand poetry:

1. `Joystick`
2. `REAL WORK. PLAYABLE.`
3. plain-language description of what the platform does

Do not overload the pitch deck with "higher reality", "portal", or self-help language. Cinematic/aspirational copy may be used selectively in top-of-funnel marketing, but the core brand promise stays grounded in real work and control.

Inside a chosen game, use that game's own narrative vocabulary instead of repeating `REAL WORK. PLAYABLE.` throughout gameplay.

## Product architecture implication

Future implementation work should treat Joystick branding and game branding as separate layers:

```text
JOYSTICK PLATFORM
  signup / onboarding / game selection / app shell bootstrap
              ↓ user chooses game
SELECTED GAME IDENTITY
  Goldline | Basketball Draft | future game
              ↓
  mobile + desktop gameplay owned visually by that game
```

Do not solve this by building one permanently visible Joystick navigation shell around every game. The platform layer should largely disappear once the game boots.

## Asset-production task still required

The approved concept board is the **visual authority**, but the final production vector package still needs to be created and checked into the repo or brand asset store.

When creating that package:

- trace/rebuild the approved shape faithfully
- do not reinterpret the J geometry
- do not add/remove facial/character details unless they are present in the approved master asset Adam selects for export
- do not alter the charcoal/amber/white relationship
- compare the finished SVG directly against the approved board before sign-off
- produce an app-icon and splash-screen-safe version because these are the primary recurring in-product places where the Joystick mark is intentionally visible

Until the final vector asset is checked in, this document is the canonical written specification for the locked direction.
