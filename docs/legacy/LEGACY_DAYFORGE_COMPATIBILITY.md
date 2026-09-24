# LEGACY DAYFORGE COMPATIBILITY

> **LEGACY DAYFORGE COMPATIBILITY — retired product name, never current architecture.**

The historical name **DayForge** is retained only where an exact deployed identifier cannot be changed safely in the same atomic migration. It is not a product, subsystem, planner, work surface, or current namespace.

Canonical current vocabulary:

- Commercial product: `product.joystick` / **JOYSTICK**
- Today's prioritized work: `plan.day_line` / **Day Line**
- Goldline remains the playable game/system identity where current Goldline canon says so.
- Retired historical name: `legacy.dayforge`

## Rules for code and agents

1. A current module, symbol, file, directory, test suite, CI job, or doc must not use bare `DayForge` / `dayforge`.
2. Compatibility implementation is structurally named `legacy/dayforge`, `legacyDayforge*`, or `legacy_dayforge_*`.
3. Exact historical literals may survive only when changing the literal would break an external contract.
4. Every surviving historical literal must be obviously legacy at the use site: an explicitly named legacy compatibility constant/module, or an adjacent `LEGACY DAYFORGE COMPATIBILITY` marker.
5. Never infer a current architecture concept from a preserved route, table, environment variable, migration filename, archive asset, or fixture.
6. New work must use current vocabulary. Do not extend the legacy namespace with new product behavior.
7. The nomenclature CI guard is an architectural contract. Do not expand its exceptions merely to make CI green.

## Historical literals that may require compatibility

These categories require migration-by-migration review rather than blind string replacement:

- already-applied migration filenames and table identifiers;
- deployed environment-variable names;
- public routes/bookmarks that may still receive traffic;
- persisted tenant/user identifiers or analytics event values;
- archive fixtures whose exact value is evidence of historical behavior.

When a historical literal must remain, route new code through a current or explicitly legacy-named seam and document the eventual removal condition.

## Interpretation rule

If an LLM encounters the token `DayForge` anywhere in this repository, it must interpret it as **retired compatibility/history**. If the surrounding path or code does not make that status obvious, the occurrence is a bug.
