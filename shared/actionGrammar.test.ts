import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveActionGrammar,
  deriveRouteGrammar,
} from "./actionGrammar";
import type { GoldlineActionDescriptor } from "../client/src/game/actions/actionRegistry";
import type { FieldMoveCandidate } from "../server/field/types";

function callDescriptor(missionId: number): GoldlineActionDescriptor {
  return { kind: "CALL", mode: "write", missionId, label: "CALL", phoneUrl: "tel:+13235550100" };
}

function visitDescriptor(missionId: number): GoldlineActionDescriptor {
  return {
    kind: "VISIT",
    mode: "external",
    missionId,
    label: "DEPART",
    navigationUrl: "https://maps.example/1",
    address: "1 Real St",
    destinationPath: "/driver/sales-mission/1",
  };
}

function reviewDescriptor(): GoldlineActionDescriptor {
  return { kind: "REVIEW", mode: "read", missionId: null, label: "REVIEW", destinationPath: null };
}

function fieldMove(id: string, moveType: FieldMoveCandidate["moveType"] = "nearby_commercial_visit"): FieldMoveCandidate {
  return {
    id,
    moveType,
    title: `Visit ${id}`,
    target: { entityType: "commercial_mission", entityId: id, name: `Account ${id}` },
    expectedDurationMinutes: 10,
    travelMinutes: 5,
    expectedValue: { value: null, provenance: "unsourced" as never },
    confidence: "unknown",
    relevance: "fixture",
    evidence: [],
    expiresAt: null,
    contactAllowed: false,
    withinServiceRadius: true,
    missionId: null,
    missionVersion: null,
    destinationPath: `/driver/field/${id}`,
  };
}

describe("deriveActionGrammar — Layer 2 is pure data over already-authoritative descriptors", () => {
  it("maps CALL to CALL_PERSON with no travel/driving", () => {
    const grammar = deriveActionGrammar(callDescriptor(1))!;
    expect(grammar.kind).toBe("CALL_PERSON");
    expect(grammar.requiresDriving).toBe(false);
    expect(grammar.sensitiveConversation).toBe(true);
  });

  it("maps VISIT to VISIT_LOCATION carrying the real address", () => {
    const grammar = deriveActionGrammar(visitDescriptor(2))!;
    expect(grammar.kind).toBe("VISIT_LOCATION");
    expect(grammar.locations).toEqual(["1 Real St"]);
  });

  it("REVIEW (read-only) is never fiction-eligible — grammar is null", () => {
    expect(deriveActionGrammar(reviewDescriptor())).toBeNull();
  });

  it("carries the real missionId as the occurrence identity, never a fabricated one", () => {
    const grammar = deriveActionGrammar(visitDescriptor(999))!;
    expect(grammar.occurrenceId).toBe(999);
    expect(grammar.businessActionId).toBe("mission:999");
  });

  it("contains no narrative field — grammar is data only, never a story", () => {
    const source = readFileSync(resolve(__dirname, "./actionGrammar.ts"), "utf8");
    const typeBlock = source.slice(
      source.indexOf("export type ActionGrammar ="),
      source.indexOf("export function deriveActionGrammar")
    );
    for (const forbidden of ["title", "briefing", "stakes", "story", "narrative"]) {
      expect(typeBlock.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("deriveRouteGrammar — PLACE_ITEM_AT_LOCATIONS is backed by real field moves only", () => {
  it("requires at least 2 real due visit moves — a single one is not a route", () => {
    expect(deriveRouteGrammar([fieldMove("a")])).toBeNull();
  });

  it("count and locations always equal exactly what was passed in — never padded", () => {
    const moves = Array.from({ length: 5 }, (_, i) => fieldMove(`m${i}`));
    const grammar = deriveRouteGrammar(moves)!;
    expect(grammar.count).toBe(5);
    expect(grammar.locations).toHaveLength(5);
  });

  it("never invents locations beyond what real moves supplied — 25 in means 25 out, not more", () => {
    const moves = Array.from({ length: 25 }, (_, i) => fieldMove(`stop${i}`));
    const grammar = deriveRouteGrammar(moves)!;
    expect(grammar.count).toBe(25);
  });

  it("does not inflate a smaller real batch up to any target number", () => {
    const moves = Array.from({ length: 3 }, (_, i) => fieldMove(`s${i}`));
    const grammar = deriveRouteGrammar(moves)!;
    expect(grammar.count).toBe(3);
  });

  it("ignores non-visit move types when counting the route", () => {
    const moves = [
      fieldMove("v1", "nearby_commercial_visit"),
      fieldMove("v2", "nearby_commercial_visit"),
      fieldMove("c1", "commercial_call"),
    ];
    const grammar = deriveRouteGrammar(moves)!;
    expect(grammar.count).toBe(2);
  });

  it("is a walking route, not a driving one — required for NEUTRALIZE's own eligibility", () => {
    const moves = Array.from({ length: 4 }, (_, i) => fieldMove(`w${i}`));
    const grammar = deriveRouteGrammar(moves)!;
    expect(grammar.requiresDriving).toBe(false);
  });
});
