# GOLDLINE Day Line graphic Action Cards v2

Visual authority: Adam's `goldline_day_line_adventure.v2.png`, supplied October 10, 2026. The original handoff's functional and integrated-surface requirements remain in effect. The strict overhead chest requirement takes precedence over the oblique chest shown in the reference. Illustrative names, weights and revenue in the reference are not production data.

## Result

Removed the sibling rectangular mission-panel system and its 721-line accumulated material/gradient styling. Pickup, dropoff, growth and marketing are illustrated object buttons with live copy inside measured physical surfaces. Consecutive sales share a connected descending structure with four different curved red wall inscriptions. Every source ID remains independently selectable and the compositor never sorts or writes business records.

For more than four consecutive sales, additional four-turn sections extend the same environment; intermediate basins and later launch sections are clipped at the joins. No mission is dropped or merged. Single sales use a mounted course segment with one launch and destination basin.

The provided duffel, leaf, world and scenery are preserved. The chest camera was corrected to overhead. The puzzle's recessed lower information surface was added. The sales structure was corrected to provide sufficiently deep physical red walls. WebP encoding uses quality 90 and alpha quality 100, preserving intrinsic dimensions and transparency; the four-sales scene requires approximately 1.4 MiB of background, main artwork and idle avatar (walking frames are fetched only when explicitly allowed).

Marketing presentation requires a literal typed `marketing` objective or the authoritative source kind `marketing_challenge`. Titles, addresses and customer names never determine that category. Unclassified prep/processing tasks retain their existing category. No marketing objective is manufactured for the current day.

The existing stop dialog supplies complete titles, addresses and navigation, including when a long field is abbreviated on a physical surface. Completion indicators read only the existing projection status. This implementation does not offer a decorative unseal operation or change underlying completion authority.

## Asset loading and progress

The background, actual object assets, relevant scenery, idle frame and allowed walking frames decode before the initial scene is revealed. Initial business-data loading is also respected. Successfully decoded art is cached across asynchronous data changes; the visible avatar is retained. Failed loads remain unready and offer retry. The avatar occupies a separate sticky climb lane. Opening, scrolling and selecting objects do not create progress. Initial loaded completion positions are applied without walking animation. Motion additionally requires the existing explicitly non-driving signal and honors reduced motion.

## Verification

Actual production-build browser tests use `VITE_GOLDLINE_TEST_HARNESS=1 pnpm build` followed by `pnpm exec playwright test --config playwright.dayline-art.config.ts`. The harness is excluded when that compile-time flag is absent from a release build.

The suite checks 390×844 and 430×932, one/three missions, four consecutive sales, mixed five-category work, eight mixed missions, eight sales, long names/addresses, absent locations and completed/incomplete actions. It opens every mission independently and asserts that canonical text and source IDs survive. It verifies transparent text surfaces, readable title fonts, bounded surfaces, no overflowing text, no old rectangular panel containers, no browser exceptions and failure/retry behavior.

Cold captures are made at initial DOM load, 1s, 3s and 8s, then after scrolling. Tests assert that the avatar remains visible and scrolling/selection preserve progress, while a fixture completion changes only the expected verified fraction. Fixture completion is test-only state and never writes production.

Outputs: `artifacts/goldline-graphic-actions/`. `comparison.html` displays the supplied v2 reference alongside actual mixed-day and four-sales application screenshots. Screenshots are browser renders, not generated UI mockups. Final validation counts, build, typecheck and release information are recorded in the PR.

## Final runtime assets and provenance

Assets are shipped at `public/goldline/dayline-v2/`, exposed through the existing public-directory symlink convention.

| Runtime asset | Source |
|---|---|
| `objects/pickup.webp` | Supplied v1 pickup art, encoding only |
| `objects/growth.webp` | Supplied v1 growth art, encoding only |
| `background/world-clean.webp` | Supplied clean world, encoding only |
| `scenery/foreground-cutouts-atlas.webp` | Supplied scenery atlas, encoding only; sampled with CSS |
| `states/sales-open.webp` | Existing supplied open sales art, encoding only; terrain launch/basin sampling does not represent mission completion |
| `objects/dropoff.webp` | Built-in ImageGen output `exec-baae8be3-4038-4c61-a340-0f25bd1919a2` |
| `objects/sales-course.webp` | Built-in ImageGen output `exec-68b34c70-56e7-49c4-83a8-f1403d086ef9` |
| `objects/marketing.webp` | Built-in ImageGen output `exec-929fd356-29ab-4d70-b77f-cf530dc59b9a`, refining `exec-217d02ae-1be1-41b8-adcd-c60ea2b74c30` |
| `objects/sales-four.webp` | Built-in ImageGen output `exec-f8106e7b-99e8-4cde-93ef-84085b8d0920`, refining `exec-c31ace4d-2504-4f78-853c-e2e2ad7b5769` |

Image generation used the built-in tool, with supplied primary assets and approved v2 as references. No external model/API or generated fixed mission text was used. Original generated PNGs remain in the local generated-image directory. Final prompts are recorded in `DAYLINE_GRAPHIC_ASSET_PROMPTS.md`.
