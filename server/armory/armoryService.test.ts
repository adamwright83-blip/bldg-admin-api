import { describe, expect, it } from "vitest";
import { classifyObjectionArchetype } from "./armoryService";

describe("objection presentation archetypes",()=>{
  it("maps factual language to a thin game label",()=>{
    expect(classifyObjectionArchetype("I could not reach the decision maker")).toBe("GATEKEEPER");
    expect(classifyObjectionArchetype("They already have a vendor under contract")).toBe("ANCHOR");
    expect(classifyObjectionArchetype("They said circle back next quarter")).toBe("STALLER");
    expect(classifyObjectionArchetype("They never replied")).toBe("GHOST");
  });
  it("does not invent an archetype when evidence does not match",()=>expect(classifyObjectionArchetype("Great meeting")).toBeNull());
});
