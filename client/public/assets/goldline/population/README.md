# Goldline coastal population atlas

`coastal_roles.webp` is a 1536×512 real-alpha atlas with six 256×512 cells.
The source was supplied on 2026-08-13 as one RGBA adult-role lineup. Three
neighboring pairs touch in the source alpha, so the export uses documented
vertical seams at their natural overlaps; no generative repaint, inpainting,
or older concept art was used. Covered anatomy was not invented. The roles are
usable at runtime scale, while their seam and edge quality remains subject to
human visual approval.

| Cell | `spriteId`     | Supplied static role read        |
| ---- | -------------- | -------------------------------- |
| 0    | `field-role-a` | access/checking worker           |
| 1    | `field-role-b` | conversational traveler          |
| 2    | `field-role-c` | older market carrier             |
| 3    | `field-role-d` | stall/merchant worker            |
| 4    | `field-role-e` | produce carrier / conversation A |
| 5    | `field-role-f` | parcel carrier / conversation B  |

The atlas supplies one static pose per role, not behavior frames. The existing
deterministic path movement and restrained rotation continue to provide light
presentation motion. The source does not literally depict a phone or
clipboard, so those manifest behaviors remain semantic staging rather than a
claim of bespoke pose animation.

`PopulationSystem` loads this file once, creates six Pixi sub-textures sharing
that source, and maps `spriteId` deterministically. The engineering `Graphics`
fallback remains available only when the manifest is explicitly placeholder
stage or the atlas load fails; runtime diagnostics then report
`engineering_placeholder`, so a failed atlas can never masquerade as
production presentation.
