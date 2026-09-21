/**
 * Test-only dramaturgy rule injection. Do not import from production
 * Narrator paths. `server/narratorOs/index.ts` does not re-export this
 * module. Production `decideDramaturgy` cannot take a caller catalog.
 */
import type { NarrativeEligibilityResult } from "../../shared/narratorOs/contracts";
import type { DramaturgyDecision } from "../../shared/narratorOs/contracts";
import type { AuthoredDramaturgyTieBreak } from "./dramaturgy";
import { decideDramaturgyWithCatalog } from "./dramaturgySelect";

function assertTestDramaturgyAllowed(): void {
  const nodeEnv = process.env.NODE_ENV;
  const inVitest = Boolean(process.env.VITEST);
  if (nodeEnv === "test" || inVitest) return;
  throw new Error(
    "Dramaturgy test rule injection is not available outside tests"
  );
}

export function decideDramaturgyWithRulesForTests(input: {
  readonly eligibility: NarrativeEligibilityResult;
  readonly tieBreaks: readonly AuthoredDramaturgyTieBreak[];
}): DramaturgyDecision {
  assertTestDramaturgyAllowed();
  return decideDramaturgyWithCatalog(input.eligibility, input.tieBreaks);
}
