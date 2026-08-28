# Admin game archive and reuse inventory

The active Laundry Butler Admin product is now a truth-and-control workspace. This document records game-oriented Admin presentation that remains preserved for possible Goldline Driver reuse. Nothing listed here is approved future scope by implication.

Tower Wars is explicitly excluded from this archive. It remains active because its architectural state is deterministically driven by real building revenue and every visual comparison exposes the underlying dollar values.

## CommandLanternKingdom

- Former Admin role: gamified business-progress home and kingdom state.
- Previous route: `/` through the former `OpsBoardHome` composition.
- Preserved location: `client/src/components/admin/CommandLanternKingdom.tsx`, its stylesheet, and `kingdomArt.ts`.
- Dependencies/assets: Command Sky, kingdom art, composer and Admin kingdom assets under `client/public/admin-assets/`.
- Business logic preserved elsewhere: current operational, payment, and customer truth is read directly by the new Admin Home; no kingdom score is treated as authoritative business state.
- Possible future Goldline reuse: persistent world-state presentation, lantern progression, atmosphere, and world mutation.
- Migration note: disconnected from the normal Admin Home import graph.

## OpsBoardHome and SaleslayBattleCanvas

- Former Admin role: game-heavy board, combat surface, Sage summon, bold-pitch weapon flow, and operator-demo composition.
- Previous routes: `/` and `/demo`.
- Preserved locations: `client/src/components/admin/ops-board/` and `client/src/components/admin/saleslay-game/`.
- Dependencies/assets: Saleslay engine, composer, Command Sky, War Strip, and `client/public/assets/saleslay/`.
- Business logic preserved elsewhere: Home reads dashboard, payment, customer, and order-status contracts directly; the commercial pipeline and Sales Intel routes remain available from Growth.
- Possible future Goldline reuse: encounter feedback, action confirmation, combat choreography, and Sage presentation.
- Migration note: `AdminHome.tsx` no longer imports `OpsBoardHome`, so this material is not loaded by the active Home bundle.

## Level4OffensiveHost and Level 4 battle presentation

- Former Admin role: operational/sales war mode and tactical battle canvas.
- Previous route: `/level4`.
- Preserved locations: `client/src/components/Level4OffensiveHost.tsx`, `Level4Offensive.tsx`, `Level4WarLayer.tsx`, associated styles, and `client/public/assets/level4/`.
- Business logic preserved elsewhere: deterministic receivable intervention candidates remain available to the Admin Exception Center via the existing Level 1/2 read contracts.
- Possible future Goldline reuse: special challenge, encounter pressure, enemy mechanics, and battle feedback.
- Migration note: removed from active navigation and converted to a lazy compatibility route so the normal Admin bundle does not eagerly load it.

## CommandSky, WarStrip, and operator-analyst presentation

- Former Admin role: operational weather, war-state strip, and analytical/game composition.
- Previous route: composed inside the former Home.
- Preserved locations: `client/src/components/admin/CommandSky.tsx`, `CommandCockpitBand.tsx`, and `client/src/components/admin/operator-analyst/`.
- Dependencies/assets: operator analyst assets under `client/public/admin-assets/operator-analyst/`.
- Business logic preserved elsewhere: real exceptions and source-health labels now communicate management state directly.
- Possible future Goldline reuse: truth-bound atmosphere or field-state weather, but only if a deterministic source mapping is defined.
- Migration note: not imported by the active Home.

## Preservation boundary

- Archived from active Admin: combat, weapons, mission execution, personal “one thing right now,” XP/rating fallbacks, and field-action mechanics.
- Preserved in active Admin: Tower Wars, restrained semantic color, operational stage visualization, account health, and other metaphors whose state maps one-to-one to authoritative data.
- Existing files and assets are intentionally retained. This change alters active imports and navigation; it does not destructively delete reusable game material.
