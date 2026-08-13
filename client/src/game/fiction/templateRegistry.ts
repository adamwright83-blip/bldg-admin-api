/**
 * The registered set of Fiction Templates. Adding a new genre episode later
 * is a matter of adding an entry here plus its own file under `templates/`
 * — the Fiction Director, eligibility, and determinism logic never change.
 *
 * NEUTRALIZE is the first proof. It is intentionally not the only reason
 * this architecture exists: any future template need only declare its
 * `compatibleGrammarKinds` and safety class to slot in.
 */
import type { FictionTemplate } from "../../../../shared/fictionTemplate";
import { NEUTRALIZE_TEMPLATE } from "./templates/neutralizeTemplate";

export const FICTION_TEMPLATE_REGISTRY: readonly FictionTemplate[] = [
  NEUTRALIZE_TEMPLATE,
];
