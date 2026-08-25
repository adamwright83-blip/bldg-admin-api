# Future Goldline stage authoring gate

The Wayward Approach and Crystal Chasm reference paintings are oversized world
plates, not mobile screenshots. Never fit the full painting into the portrait
viewport. Their versioned navigation and camera contracts live in
`client/src/pages/goldline/stages/futureStages.ts`.

Before either stage becomes selectable, art must be delivered as aligned
exports with identical canvas dimensions:

1. opaque far/background plate;
2. transparent fixed mid-ground plate;
3. transparent foreground masks matching every named mask in the contract;
4. live sprites/entities for every interactive or stateful object.

The supplied flattened paintings are references only. Do not fabricate a
foreground mask by duplicating the entire painting: it would cover the player
everywhere and defeat depth ordering. Pip and the Prism Regent must be removed
from production background plates and supplied as live entities if used.

Walkability comes only from the authored polygons and corridors. Rectangular
movement bounds are forbidden. The camera follows the player with damping,
stays inside authored bounds, and reveals destinations progressively. Screen Y
drives character scale and a restrained speed adjustment; tune the values
against final separated art rather than treating the initial values as final.

Gold Line, Trace, Recall, hook rings, enemies, pickups, hazards, doors,
destructibles, and mission-state changes are always runtime layers.
