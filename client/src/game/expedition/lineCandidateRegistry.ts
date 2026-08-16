/**
 * The Linehook candidate registry.
 *
 * `lineTargets.ts` gives us a branded union, but a brand alone is NOT a
 * semantic guarantee: `hostileTarget({...})` can be called with any
 * coordinates and any identity data, so nothing in the type system stops a
 * careless caller from minting a "hostile" out of a civilian's position.
 *
 * This registry is the actual boundary. It is the ONLY thing the Linehook
 * ever aims at, and it can only be populated by:
 *
 *   - `registerHostile()`, called by the Ruinbound spawner with a hostile
 *     instance it just constructed itself; and
 *   - `registerEnvironment()`, called by the expedition plan with an
 *     explicitly authored architecture/hazard anchor.
 *
 * There is deliberately no bulk `addAll`, no constructor that takes a
 * collection, and no path that accepts a PopulationSystem entity, an order
 * embodiment, or a business-person embodiment in any shape. Candidates are
 * never *derived by filtering* a general world collection — that pattern is
 * exactly how a civilian ends up one predicate-edit away from being
 * targetable, and it is structurally absent here.
 *
 * `e2e/goldline/pickupExpeditionHeartbeat.spec.ts` proves the runtime half:
 * with civilians and the real pickup marker visibly inside the cone and
 * range, the registry still reports them as absent.
 */
import {
  environmentTarget,
  hostileTarget,
  selectLineTarget,
  rankLineTargets,
  type AimQuery,
  type EnvironmentLineTarget,
  type HostileLineTarget,
  type LineTarget,
  type LineTargetCandidate,
} from "./lineTargets";

/** Live fictional hostile. Only the Ruinbound runtime constructs these. */
export type HostileInstanceView = {
  readonly id: string;
  readonly hostile: HostileLineTarget["hostile"];
  readonly x: number;
  readonly y: number;
  /** False once defeated. */
  readonly alive: boolean;
  /** False while spawning in, or occluded behind a foreground layer. */
  readonly onScreen: boolean;
  readonly guardFacing: number | null;
};

/** Authored interactive scenery. Only the expedition plan constructs these. */
export type EnvironmentInstanceView = {
  readonly id: string;
  readonly environment: EnvironmentLineTarget["environment"];
  readonly x: number;
  readonly y: number;
  /** False once a hazard has been triggered / spent. */
  readonly armed: boolean;
  readonly onScreen: boolean;
};

export class LineCandidateRegistry {
  private hostiles = new Map<string, HostileInstanceView>();
  private environment = new Map<string, EnvironmentInstanceView>();

  registerHostile(view: HostileInstanceView) {
    this.hostiles.set(view.id, view);
  }

  registerEnvironment(view: EnvironmentInstanceView) {
    this.environment.set(view.id, view);
  }

  unregisterHostile(id: string) {
    this.hostiles.delete(id);
  }

  unregisterEnvironment(id: string) {
    this.environment.delete(id);
  }

  clear() {
    this.hostiles.clear();
    this.environment.clear();
  }

  /** Diagnostic surface for the E2E civilian-absence proof. */
  candidateIds(): string[] {
    return [
      ...Array.from(this.hostiles.keys()),
      ...Array.from(this.environment.keys()),
    ].sort();
  }

  has(id: string): boolean {
    return this.hostiles.has(id) || this.environment.has(id);
  }

  size(): number {
    return this.hostiles.size + this.environment.size;
  }

  /**
   * Projects registered instances into branded targets. This is the single
   * place `hostileTarget`/`environmentTarget` are minted during play, so
   * the factories are not a loose entry point in the running game.
   */
  targets(): LineTarget[] {
    const out: LineTarget[] = [];
    for (const h of Array.from(this.hostiles.values())) {
      out.push(
        hostileTarget({
          id: h.id,
          x: h.x,
          y: h.y,
          active: h.alive,
          readable: h.onScreen,
          hostile: h.hostile,
          guardFacing: h.guardFacing,
        })
      );
    }
    for (const e of Array.from(this.environment.values())) {
      out.push(
        environmentTarget({
          id: e.id,
          x: e.x,
          y: e.y,
          active: e.armed,
          readable: e.onScreen,
          environment: e.environment,
        })
      );
    }
    // Stable order in, stable order out — selection tie-breaking already
    // sorts by id, but keeping this deterministic makes the aim overlay's
    // render order stable too.
    out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
  }

  select(query: AimQuery): LineTarget | null {
    return selectLineTarget(this.targets(), query);
  }

  rank(query: AimQuery): LineTargetCandidate[] {
    return rankLineTargets(this.targets(), query);
  }
}
