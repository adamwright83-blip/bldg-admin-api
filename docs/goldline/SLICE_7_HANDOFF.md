**This document constrains future Goldline work. Current production/main outranks prose. Do not rebuild systems that already satisfy these laws.**

# SLICE 7 HANDOFF — Claire relationship offboarding surface

**Status: IN PROGRESS.**
**Branch:** `chatgpt/behavioral-slice-7-claire-offboarding`
**Base:** `main` @ `fd3fc3913cb4687fcf82f4259f596fa269feb408`

## Why this is Slice 7

Behavioral-science Slices 1–6 are merged. Slice 6 explicitly left one relationship-layer task in `docs/GOLDLINE-TASKS.md`: Driver/Admin UI for the existing `composeClaireRelationshipClosing` server/domain contract. Adam explicitly asked to execute “Slice 7” on 2026-09-17, so this narrow leftover is the scope. This is not BUILD_BRIEF Slice 7 and does not create a new behavioral-science architecture.

## Objective

Expose the existing safe relationship-closing artifact through authenticated Claire API/UI surfaces without deleting or mutating authoritative business records, weakening approval gates, inventing emotional claims, or creating another memory system.

## Existing infrastructure to reuse

- `server/claire/character/relationshipOffboarding.ts`
- `server/claire/character/relationshipHistory.ts`
- `server/claire/claireRouter.ts`
- `client/src/pages/DayforgeSettingsPage.tsx`
- existing relationship event/state/tier/compiler infrastructure from Slice 6

## Non-goals

- no Joystick branding work
- no Driver game redesign
- no new memory table
- no relationship-score redesign
- no business-record deletion
- no diagnosis
- no adaptive behavioral optimization
- no fake `DEFERRED`

## Truth requirements

- Closing copy may use only the existing eligible `verified-shared` and `operator-declared` history classes.
- Business records remain unchanged.
- The UI must not imply account deletion.
- The UI must not claim Claire has feelings or consciousness.
- Any API endpoint is self-scoped by tenant + authenticated operator.
- Existing assertion/approval boundaries remain unchanged.

## Planned implementation

1. Add a self-scoped Claire router query that loads bounded relationship history and returns `composeClaireRelationshipClosing(...)`.
2. Add a small Claire relationship-closing section to the existing settings surface.
3. Add focused tests around endpoint/self-scope and UI contract where practical.
4. Update `docs/GOLDLINE-TASKS.md` when complete.
5. Run relevant focused tests/typecheck and rely on PR CI for Fast Goldline, DayForge, and mobile regression.

## Open point

The Slice 6 domain contract produces a closing artifact but does not itself persist a separate “continuity disabled” flag. This slice will not invent a second persistence model merely to make the UI appear more complete. If product later requires a durable opt-out toggle that suppresses future relationship-context retrieval, that should be implemented explicitly as its own truthful preference/state contract rather than inferred from generating the closing artifact.
