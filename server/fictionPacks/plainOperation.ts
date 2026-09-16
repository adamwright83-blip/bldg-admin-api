/**
 * plain_operation — the mundane pack.
 *
 * Deliberately boring: it states the real work in plain language and adds no
 * genre at all. It exists for two reasons.
 *
 * 1. It is the debuggable baseline. When something looks wrong in a run, render
 *    it through this pack and see the truth with no costume on it.
 * 2. It is the control in the re-skin test (docs/goldline/FICTION_PACKS.md
 *    section 11). Switching a run from this pack to bio_containment must change
 *    nothing except words. That is the whole thesis, and reskin.test.ts asserts
 *    it.
 *
 * It obeys every law the dramatic packs obey, including the ban on business
 * nouns — plain is not the same as tenant-specific.
 */
import type { FictionPack } from "../../shared/fictionPack";
import { validateFictionPack } from "../../shared/fictionPack";

export const PLAIN_OPERATION_PACK: FictionPack = validateFictionPack({
  id: "plain_operation",
  version: 1,
  role: "operator",
  premise: "A list of real addresses to cover.",
  briefing:
    "Work the list. Confirm each one as you go. Progress is kept between sessions.",
  objectiveLabels: {
    unit: "stop",
    unitPlural: "stops",
    action: "cover",
    grid: "list",
  },
  progressBeats: [
    {
      id: "plain_quarter",
      atFraction: 0.25,
      text: "{count} of {total} covered.",
      requires: ["count", "total"],
    },
    {
      id: "plain_half",
      atFraction: 0.5,
      text: "{count} of {total} covered. Halfway.",
      requires: ["count", "total"],
    },
    {
      id: "plain_three_quarter",
      atFraction: 0.75,
      text: "{count} of {total} covered. {remaining} left.",
      requires: ["count", "total", "remaining"],
    },
    {
      id: "plain_complete",
      atFraction: 1,
      text: "{count} of {total} covered.",
      requires: ["count", "total"],
    },
  ],
  proofFraming: "Confirm each one as you place it.",
  victoryBeat: "List complete. Every address on it was covered and confirmed.",
  tempoTails: {
    clean_break: "Finished in one or two sittings.",
    wounded: "Finished across a few sittings.",
    gone_to_ground: "Finished across several sittings, with longer gaps between them.",
  },
  echoPresentation: "{count} covered. {remaining} still to do. Nothing expires.",
  failureSequence: null,
  visualTheme: { palette: "plain" },
  audioTheme: {},
});
