/**
 * The one canonical way an unfinished promise shows up in the world.
 *
 * A restrained Gold Line tether running to the building, ending in a sealed
 * node. Not a badge, not a todo chip, not a red dot — one grammar, so a player
 * never has to learn that three different marks all mean "you owe something
 * here".
 *
 * It is attached to the actual building representation and lives inside the
 * camera-transformed world, so it pans and zooms with the place it belongs to.
 *
 * Nothing in this component can clear a promise. It renders what the Chronicle
 * projected and has no callback, no mutation and no dismiss.
 */

import type { ObligationPresentation } from "@shared/goldlineObligations";

export function WorldObligationTether({
  obligations,
  buildingName,
}: {
  obligations: ObligationPresentation | null | undefined;
  buildingName: string;
}) {
  if (!obligations) return null;

  return (
    <span
      className={`lc-tether tension-${obligations.tension}`}
      /*
        The restraint is information, so it is announced rather than left as
        something only a sighted player can notice. The explanation is the same
        sentence the inspector shows.
      */
      role="img"
      aria-label={`${buildingName}: ${obligations.explanation}`}
      data-obligations={obligations.count}
    >
      <i className="lc-tether-line" aria-hidden />
      <i className="lc-tether-seal" aria-hidden>
        {obligations.count > 1 ? obligations.count : null}
      </i>
    </span>
  );
}
