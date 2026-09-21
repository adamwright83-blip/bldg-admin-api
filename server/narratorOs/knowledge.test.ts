import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyKnowledgeWrite, EMPTY_KNOWLEDGE, planeKnows } from "./store";
import { assertNewUserSeed, initNarratorOperator } from "./init";
import { livedBioHasClaireCreatedGoldline } from "./livedBio";
import { createInMemoryNarratorStore } from "./memoryStore";
import { worldTruthValue } from "./worldTruth";
import { getBeat } from "./registry";

const scope = { tenantId: "t1", operatorUserId: "op-new" };

describe("Narrator OS slice B — knowledge + narrative state", () => {
  it("does not treat world truth as Claire or player knowledge", async () => {
    const store = createInMemoryNarratorStore();
    const snapshot = await initNarratorOperator(store, scope);
    expect(worldTruthValue("17k_recorded_environmental_provenance_wrong")).toBe(
      "Recorded environmental provenance is wrong."
    );
    expect(
      planeKnows(
        snapshot.knowledge,
        "PLAYER",
        "17k_recorded_environmental_provenance_wrong"
      )
    ).toBe(false);
    expect(
      planeKnows(
        snapshot.knowledge,
        "CLAIRE",
        "17k_recorded_environmental_provenance_wrong"
      )
    ).toBe(false);
  });

  it("does not copy player knowledge onto Claire", async () => {
    const store = createInMemoryNarratorStore();
    const snapshot = await initNarratorOperator(store, scope);
    const next = applyKnowledgeWrite(snapshot.knowledge, {
      plane: "PLAYER",
      factId: "cove_origin_false",
      op: "learn",
      kind: "EVENT_FACT",
    });
    expect(planeKnows(next, "PLAYER", "cove_origin_false")).toBe(true);
    expect(planeKnows(next, "CLAIRE", "cove_origin_false")).toBe(false);
  });

  it("does not promote Claire's lived belief into WORLD_TRUTH", async () => {
    expect(livedBioHasClaireCreatedGoldline()).toBe(false);
    expect(worldTruthValue("source_woman_created_goldline")).toMatch(
      /Source Woman created Goldline/
    );
    expect(worldTruthValue("claire_adapted_father_disappearance")).toBeNull();
    expect(
      worldTruthValue("source_woman_father_was_17k_provenance_lead")
    ).toMatch(/Source Woman's real father/);
  });

  it("lets the chemist know a narrow observation without the player knowing", async () => {
    const store = createInMemoryNarratorStore();
    const snapshot = await initNarratorOperator(store, scope);
    const next = applyKnowledgeWrite(snapshot.knowledge, {
      plane: "CHEMIST",
      factId: "17k_recorded_environmental_provenance_wrong",
      op: "learn",
      kind: "EVENT_FACT",
    });
    expect(
      planeKnows(next, "CHEMIST", "17k_recorded_environmental_provenance_wrong")
    ).toBe(true);
    expect(
      planeKnows(next, "PLAYER", "17k_recorded_environmental_provenance_wrong")
    ).toBe(false);
  });

  it("does not treat player-visible occurrence as Claire having learned the fact", () => {
    const beat = getBeat("K-COVE-ORIGIN");
    expect(
      beat.knowledgeMutations.some(mutation => mutation.plane === "PLAYER")
    ).toBe(true);
    expect(
      beat.knowledgeMutations.some(mutation => mutation.plane === "CLAIRE")
    ).toBe(false);
    const storeKnowledge = applyKnowledgeWrite(EMPTY_KNOWLEDGE, {
      plane: "PLAYER",
      factId: "cove_origin_false",
      op: "learn",
      kind: "EVENT_FACT",
    });
    expect(planeKnows(storeKnowledge, "PLAYER", "cove_origin_false")).toBe(
      true
    );
    expect(planeKnows(storeKnowledge, "CLAIRE", "cove_origin_false")).toBe(
      false
    );
  });

  it("does not rewrite EVENT_FACT when interpretation changes", async () => {
    const store = createInMemoryNarratorStore();
    const snapshot = await initNarratorOperator(store, scope);
    let knowledge = applyKnowledgeWrite(snapshot.knowledge, {
      plane: "CLAIRE",
      factId: "17k_recorded_environmental_provenance_wrong",
      op: "learn",
      kind: "EVENT_FACT",
    });
    knowledge = applyKnowledgeWrite(knowledge, {
      plane: "CLAIRE",
      factId: "17k_recorded_environmental_provenance_wrong",
      op: "set_interpretation",
      interpretation: "label later",
    });
    expect(
      planeKnows(
        knowledge,
        "CLAIRE",
        "17k_recorded_environmental_provenance_wrong"
      )
    ).toBe(true);
    expect(
      knowledge.planes.CLAIRE.factKinds[
        "17k_recorded_environmental_provenance_wrong"
      ]
    ).toBe("EVENT_FACT");
    expect(worldTruthValue("17k_recorded_environmental_provenance_wrong")).toBe(
      "Recorded environmental provenance is wrong."
    );
  });

  it("seeds a new user with an empty ledger and static authored catalogs only", async () => {
    const store = createInMemoryNarratorStore();
    const snapshot = await initNarratorOperator(store, scope);
    expect(() => assertNewUserSeed(snapshot)).not.toThrow();
    expect(snapshot.ledger).toEqual([]);
    expect(snapshot.narrativeState.values.m03).toBeUndefined();
    expect(snapshot.knowledge.planes.PLAYER.knownFactIds).toEqual([]);
  });

  it("does not synthesize narrative history from legacy business modules", () => {
    const initSrc = readFileSync(
      resolve(process.cwd(), "server/narratorOs/init.ts"),
      "utf8"
    );
    const memorySrc = readFileSync(
      resolve(process.cwd(), "server/narratorOs/memoryStore.ts"),
      "utf8"
    );
    for (const src of [initSrc, memorySrc]) {
      expect(src).not.toMatch(
        /^import .*(customers|orders|goldlineWorld|claire\/progression)/m
      );
    }
    expect(initNarratorOperator.length).toBe(2);
  });
});
