import { expect, it } from "vitest";
import { strategicCrossings } from "./goldlineCrossings";
const nodes = [{ id: "a", x: 10, y: 10, evidenceKnown: false, guardianCleared: false }, { id: "b", x: 40, y: 10, evidenceKnown: true, guardianCleared: true }, { id: "c", x: 25, y: 40, evidenceKnown: true, guardianCleared: false }];
it("is deterministic and symmetric, with visible unbuilt crossings", () => {
  expect(strategicCrossings(nodes)).toEqual(strategicCrossings([...nodes].reverse()));
  expect(strategicCrossings(nodes).some(c => c.state === "UNBUILT")).toBe(true);
});
it("keeps legitimate knowledge separate from gameplay clearance", () => {
  const known = nodes.map(n => ({ ...n, evidenceKnown: true }));
  expect(strategicCrossings(known).every(c => c.state === "AVAILABLE")).toBe(true);
  expect(strategicCrossings(known.map(n => ({ ...n, guardianCleared: true }))).every(c => c.state === "OPEN")).toBe(true);
  expect(nodes[0].evidenceKnown).toBe(false);
});
