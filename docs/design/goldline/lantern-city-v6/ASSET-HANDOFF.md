# Visual asset gate: BLOCKED ON ART

The V6 preview is **not a visual match**. Its retained V5 atlas still has the busy-background/pasted-object appearance prohibited by the approved amendment. No amount of passing layout tests changes that finding.

`asset-manifest.json` is the exact delivery contract, generated from the same canonical territory IDs and authored presentation definitions used by V6. Regenerate it with `npx tsx scripts/export-lantern-city-v6-art-manifest.ts` after presentation changes.

Deliver the neutral 3840×2160 RGB atlas and registered 1536×994 RGBA landscape variants at the paths in the manifest. Work on the initial authored neighborhoods first; remaining canonical districts are expansion dependencies for selected/new-customer territories. Alpha must cover the underlying landscape in the interior and softly blend the perimeter. Preserve paths and architecture registration across variants. Canonical masks are provided as provenance, not as masks to blindly apply to displaced art.

For each delivered territory set, put its healthy/cooling/infested/locked URLs into `SCENE_ART.territories[territoryId]` in `sceneAssets.ts`; set `SCENE_ART.base` to the new neutral atlas URL. The renderer already owns the registered slot, composited bounds, state selection, and prop placement. Missing URLs intentionally render no substitute plate. Do not replace them with gels or enlarged existing props.

The initial generated base candidate in `art-candidates/` was rejected for its vacant-lot appearance and different art direction. It is a visual experiment, not a runtime dependency. It was generated with the built-in image tool; its exact prompt is included alongside it.

Before removing the blocked status: review a real browser screenshot against the approved reference, inspect alpha/road seams, switch customer evidence through all states, hide labels, check all three desktop viewports, and verify that the neighborhoods themselves communicate their states. Supplying files is necessary but insufficient for acceptance.
