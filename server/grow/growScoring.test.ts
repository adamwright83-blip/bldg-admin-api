import { describe, expect, it } from "vitest";
import { deterministicEstimate, sourcedFact } from "../../shared/businessGame";
import { rankGrowMoves } from "./growScoring";
import type { GrowMove } from "./growTypes";

const move: GrowMove = { id: "a", moveType: "visit_nearby_prospect", title: "A", source: { type: "pipeline", id: "1", reference: "pipeline:1" }, expectedTimeMinutes: 30, cashCost: sourcedFact(0,"none"), capacityCost: sourcedFact(0,"none"), expectedValue: deterministicEstimate({lowCents:0,highCents:50000},"estimate"), confidence: "medium", evidence: [], expiresAt: null, whyNow: "active", destinationPath: "/" };
describe("GROW scarcity ranking",()=>{
  it("does not rank expired moves",()=>expect(rankGrowMoves({moves:[{...move,expiresAt:"2020-01-01T00:00:00Z"}],now:new Date("2026-01-01"),capacityFull:false})).toEqual([]));
  it("suppresses capacity-consuming visits when capacity is full",()=>expect(rankGrowMoves({moves:[move],now:new Date(),capacityFull:true})).toEqual([]));
  it("ranks higher value per minute first",()=>expect(rankGrowMoves({moves:[move,{...move,id:"b",expectedValue:deterministicEstimate({lowCents:0,highCents:100000},"estimate")}],now:new Date(),capacityFull:false})[0]?.id).toBe("b"));
});
