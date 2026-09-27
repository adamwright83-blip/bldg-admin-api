# Lantern City fog proof (Silver Lake)

A standalone proof of the new Lantern City. Real streets and buildings from OpenStreetMap
(LA County import: real height, ground elevation and unit counts), customer buildings lit
as the lanterns, charted non-customer land dimmed to dusk, and everything unearned under a
white plaster fog with gold cracks at the frontier. Claire's mission card points into the fog, and
"Simulate the win" plays the reveal.

    curl -s --data-urlencode data@query.overpass https://overpass-api.de/api/interpreter -o sl.json
    python3 build_district.py sl.json district.json
    python3 assemble.py district.json lantern-city-silver-lake.html

The lit buildings are sample multi-unit buildings, not real customers. Nothing here reads or
writes the app's data. Changing the bbox in `query.overpass` and `build_district.py` rebuilds
any US district the same way.
