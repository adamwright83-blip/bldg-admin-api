/**
 * bio_containment — the first fiction pack.
 *
 * Wraps any territory-coverage campaign as a containment field operation. It
 * knows nothing about what the units physically are, which is the whole point:
 * the same pack has to fit another trade's territory run without an edit.
 *
 * Copy discipline (docs/goldline/FICTION_PACKS.md section 8):
 * - every outcome sentence describes what Clockhead did, never what the
 *   operator failed to do;
 * - no second person in outcome copy, and no counterfactuals;
 * - beats restate a real count and assert no new knowledge;
 * - the victory beat is identical at every tempo.
 *
 * Clockhead is canon (shared/clockheadReadability.ts, shared/goldlineVoice.ts):
 * his obsession is that nothing may happen before the correct time, and the
 * correct time never arrives. He is personified deferral, which is why he
 * endorses delay instead of mocking it, and why this pack needs no shame.
 */
import type { FictionPack } from "../../shared/fictionPack";
import { validateFictionPack } from "../../shared/fictionPack";

export const BIO_CONTAINMENT_PACK: FictionPack = validateFictionPack({
  id: "bio_containment",
  version: 1,
  role: "field agent",
  premise:
    "A dispersal device is somewhere inside the district. A containment grid has to be brought online before it can be isolated.",
  briefing:
    "Every node you bring online extends the containment field. The grid cannot triangulate the source until it is whole. Nothing here can be brought online from this screen.",
  objectiveLabels: {
    unit: "detector",
    unitPlural: "detectors",
    action: "deploy",
    grid: "containment grid",
  },
  progressBeats: [
    {
      id: "bc_first_sector",
      atFraction: 0.25,
      text: "{count} NODES ACTIVE. First sector reads coherent. Coverage remains insufficient.",
      requires: ["count"],
    },
    {
      id: "bc_half",
      atFraction: 0.5,
      text: "{count} of {total} ACTIVE. Half the field is live. The rest of the district is still dark.",
      requires: ["count", "total"],
    },
    {
      id: "bc_three_quarter",
      atFraction: 0.75,
      text: "{count} ACTIVE, {remaining} DARK. The grid is holding. It is not closed.",
      requires: ["count", "remaining"],
    },
    {
      id: "bc_complete",
      atFraction: 1,
      text: "{count} of {total} ACTIVE. Grid closed.",
      requires: ["count", "total"],
    },
  ],
  proofFraming:
    "Confirm each node as you place it. The grid counts what you confirm and nothing else.",
  victoryBeat:
    "GRID COMPLETE. Source isolated. Containment holding. The district is clear.",
  tempoTails: {
    clean_break:
      "They had him at the perimeter before he had finished winding the last one. No gap to move into, and nothing ahead of the field. Clockhead, as they take him: \"...this was not the correct time.\" Claire: \"No. It wasn't.\"",
    wounded:
      "They took the site. He had already burned the ledgers. Clockhead is down, and whatever was written in them went with him. Claire: \"District's clear. He paid for the delay on the way out.\"",
    gone_to_ground:
      "The site was cold when they breached it. Clocks still running, all of them wrong on purpose. He had moved out days earlier, sometime in a gap when nothing came online. Claire: \"District's safe. That's the whole objective, and it's done. He's just not in the building.\" On every screen in the empty room, in his handwriting: \"Later. As agreed.\" Claire: \"He moves in the gaps. Nobody knew that before today. Close them next time and he has nowhere to go.\"",
  },
  echoPresentation:
    "{count} nodes holding. {remaining} dark. The grid keeps what you give it.",
  failureSequence: null,
  visualTheme: {
    palette: "containment",
    hud: "field_operation",
    grid: "node_lattice",
  },
  audioTheme: {
    bed: "low_room_tone",
    accent: "node_online",
    antagonist: "clock_tick",
  },
});
