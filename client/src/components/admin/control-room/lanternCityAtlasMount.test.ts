import { describe, expect, it } from "vitest";
import LanternCityAtlasDefault from "./LanternCityAtlas";

/**
 * REGRESSION FOR THE 612af8c CLASS OF FAILURE.
 *
 * A helper was inserted between `export default` and `function
 * LanternCityAtlas(`, so the module's default export silently became
 * `lanternPhaseSeconds` and the component was never exported. The route
 * rendered a function that returns a number, and Lantern City went blank.
 *
 * Nothing caught it: it is valid TypeScript so tsc passed, the bundle built,
 * and the ambient tests passed because they assert against SOURCE TEXT. Only
 * opening the page revealed it.
 *
 * These assertions are deliberately about module/runtime semantics rather than
 * file contents, so they cannot be satisfied by a page that does not mount.
 * Verified to FAIL against the broken shape before being committed.
 */
describe("LanternCityAtlas module contract", () => {
  it("default-exports the component itself", () => {
    expect(typeof LanternCityAtlasDefault).toBe("function");
    // With the bug this read "lanternPhaseSeconds".
    expect(LanternCityAtlasDefault.name).toBe("LanternCityAtlas");
  });

  it("does not default-export a plain value helper", () => {
    // The phase helper takes a string and returns a number. A React component
    // does not. If the default export can do that, the wrong thing is exported.
    const asHelper = LanternCityAtlasDefault as unknown as (k: string) => unknown;
    let result: unknown;
    try {
      result = asHelper("cluster-key");
    } catch {
      // Throwing is correct: a component called outside React is not callable
      // like a utility. Only a silent number is the failure we are guarding.
      result = undefined;
    }
    expect(typeof result).not.toBe("number");
  });

  it("is a component, not a hook or class factory", () => {
    // React function components take at most props + legacy ref.
    expect(LanternCityAtlasDefault.length).toBeLessThanOrEqual(2);
  });
});
