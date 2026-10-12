# DAYLINE viewport restoration

The fixed 430px artwork container bypassed the earlier phone viewport repairs (#39 / d3bd844a and #102 / 76dc9d56). Later 520px shell limits and a viewport-height shell left a black tail under the smaller scene.

The compositor now uses the existing measured visual-viewport hook. Its world frame fills that viewport; the source artwork keeps its original 941:1672 proportions and live task coordinates. Existing scenery fills taller frames and the native dock sits at their bottom. No generated assets, task data or authentication behavior changed.

Before/after images use the same fixture and 794×1856 viewport. Before: 430px world in a 520px shell. After: 794px world, 1856px frame, no empty shell below it.

Validation: 39 focused unit checks; application type check; frontend build; 36 browser checks including real Android emulation with a 980px layout on a 393px screen, reload, toolbar resize, rotation and native actions. The layout cases are now part of the existing mobile CI gate.
