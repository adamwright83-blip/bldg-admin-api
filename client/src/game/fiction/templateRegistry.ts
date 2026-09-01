/**
 * The registered set of Fiction Templates. Adding a new genre episode later
 * is a matter of adding an entry here plus its own file under `templates/`
 * — the Fiction Director, eligibility, and determinism logic never change.
 *
 * Campaign archetypes bind the day. These templates bind a single real action.
 */
import type { FictionTemplate } from "../../../../shared/fictionTemplate";
import { BEACON_WALK_TEMPLATE } from "./templates/beaconWalkTemplate";
import { CORRIDOR_TRACE_TEMPLATE } from "./templates/corridorTraceTemplate";
import { GHOST_ECHO_TEMPLATE } from "./templates/ghostEchoTemplate";
import { HELD_BREATH_TEMPLATE } from "./templates/heldBreathTemplate";
import { LANTERN_SURVEY_TEMPLATE } from "./templates/lanternSurveyTemplate";
import { NEUTRALIZE_TEMPLATE } from "./templates/neutralizeTemplate";
import { SEALED_DOORS_TEMPLATE } from "./templates/sealedDoorsTemplate";
import { WATCH_GATE_TEMPLATE } from "./templates/watchGateTemplate";
import { WORLD_HOLDS_BREATH_TEMPLATE } from "./templates/worldHoldsBreathTemplate";

export const FICTION_TEMPLATE_REGISTRY: readonly FictionTemplate[] = [
  NEUTRALIZE_TEMPLATE,
  BEACON_WALK_TEMPLATE,
  SEALED_DOORS_TEMPLATE,
  LANTERN_SURVEY_TEMPLATE,
  CORRIDOR_TRACE_TEMPLATE,
  GHOST_ECHO_TEMPLATE,
  HELD_BREATH_TEMPLATE,
  WATCH_GATE_TEMPLATE,
  WORLD_HOLDS_BREATH_TEMPLATE,
];
