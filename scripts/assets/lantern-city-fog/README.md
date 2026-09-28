# Lantern City fog proof (Silver Lake)

A standalone proof of the new Lantern City. Real streets and buildings from OpenStreetMap
(LA County import: real height, ground elevation and unit counts), customer buildings lit
as the lanterns, charted non-customer land dimmed to dusk, and everything unearned under a
white plaster fog with gold cracks at the frontier. Claire's mission card points into the fog, and
"Simulate the win" plays the reveal.

    curl -s --data-urlencode data@query.overpass https://overpass-api.de/api/interpreter -o sl.json
    python3 build_district.py sl.json district.json
    python3 pack_kit.py KIT_SOURCES_DIR kit.json
    python3 assemble.py district.json kit.json lantern-city-silver-lake.html

Buildings: OpenStreetMap is used for placement only. Every footprint gets a kit building (Kenney
City Kit Suburban + Commercial, KayKit City Builder Bits, all CC0) picked by type and shape, turned to
face its nearest street, scaled to the real footprint and height, and recoloured to the Lantern City
palette. Customer buildings keep their kit shape but glow gold with every window lit. The page has
a Kit / Grey boxes switch for comparison. Kit sources live outside the repo in
`~/Desktop/lantern-city-commercial-game/lantern-kit-sources` (kenney.nl, kaylousberg.itch.io).

The lit buildings are sample multi-unit buildings, not real customers. Nothing here reads or
writes the app's data. Changing the bbox in `query.overpass` and `build_district.py` rebuilds
any US district the same way.

The live board (`client/src/components/admin/control-room/LanternCityV7/`) no longer uses the kit:
its buildings come from Lantern City's own LA set, generated in code at each footprint's real size
(`laBuildings.ts`: craftsman, spanish, ranch, estate, dingbat, courtyard, walkup, storefront, office,
tower, warehouse, garage). The kit tooling above only rebuilds this older single-district proof.
