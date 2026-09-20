/**
 * Ordered-query continuation: resolved result vs records actually presented.
 *
 * These are the stateful cases that the old "delivered = the whole query window"
 * cursor got wrong. Each test walks a real conversation thread, not a single call.
 */

import { describe, expect, it } from "vitest";
import {
  continueOrderedQuery,
  excludeFromThread,
  isSameQueryThread,
  membersBeforeAnchor,
  openOrderedQuery,
  recordPresented,
  remainingMembers,
  resetForNewQuery,
} from "../workingMemory/orderedQuery";
import type { OrderedQueryMember } from "../contracts/workingMemory";

const FIVE: OrderedQueryMember[] = [
  { id: "evt-1", label: "Thomas" },
  { id: "evt-2", label: "Dana" },
  { id: "evt-3", label: "Priya" },
  { id: "evt-4", label: "Marcus" },
  { id: "evt-5", label: "Lena" },
];

function lastFiveSales(): ReturnType<typeof openOrderedQuery> {
  return openOrderedQuery({
    queryFingerprint: "latest_sales:5",
    parameters: { metric: "latest_sales", limit: 5 },
    requestedCardinality: 5,
    ordering: "last",
    anchorEntity: null,
    resolved: FIVE,
  });
}

describe("last five sales → the other four", () => {
  it("presenting one of five leaves the other four of THAT result", () => {
    let memory = lastFiveSales();
    // Claire resolved five but actually spoke only Thomas.
    memory = recordPresented(memory, [FIVE[0]]);

    expect(memory.resolved).toHaveLength(5);
    expect(memory.presented.map(m => m.label)).toEqual(["Thomas"]);

    const { members } = continueOrderedQuery(memory, 4);
    expect(members.map(m => m.label)).toEqual(["Dana", "Priya", "Marcus", "Lena"]);
  });

  it("does NOT return records 6-9: continuation never leaves the resolved result", () => {
    let memory = lastFiveSales();
    memory = recordPresented(memory, [FIVE[0]]);
    const { members } = continueOrderedQuery(memory, 4);

    // Every continued member must be one of the five originally resolved.
    const resolvedIds = new Set(FIVE.map(m => m.id));
    for (const member of members) expect(resolvedIds.has(member.id)).toBe(true);
    expect(members).toHaveLength(4);
  });

  it("asking again after the whole result was presented yields nothing left", () => {
    let memory = lastFiveSales();
    memory = recordPresented(memory, FIVE);
    expect(remainingMembers(memory)).toEqual([]);
    expect(continueOrderedQuery(memory, 4).members).toEqual([]);
  });

  it("continuation advances presented so a third turn does not repeat itself", () => {
    let memory = lastFiveSales();
    memory = recordPresented(memory, [FIVE[0]]);

    const first = continueOrderedQuery(memory, 2);
    expect(first.members.map(m => m.label)).toEqual(["Dana", "Priya"]);

    const second = continueOrderedQuery(first.memory, 2);
    expect(second.members.map(m => m.label)).toEqual(["Marcus", "Lena"]);
  });
});

describe("before Thomas", () => {
  it("resolves positionally inside the same result, not as a new query", () => {
    const memory = openOrderedQuery({
      queryFingerprint: "latest_sales:5",
      parameters: {},
      requestedCardinality: 5,
      ordering: "before_anchor",
      anchorEntity: "Thomas",
      resolved: [FIVE[1], FIVE[2], FIVE[0], FIVE[3]],
    });
    expect(membersBeforeAnchor(memory, "Thomas").map(m => m.label)).toEqual(["Dana", "Priya"]);
  });

  it("an anchor that is not in the result returns nothing rather than guessing", () => {
    expect(membersBeforeAnchor(lastFiveSales(), "Nobody")).toEqual([]);
  });
});

describe("exclude Thomas", () => {
  it("exclusion removes the member from continuation of this thread", () => {
    const memory = excludeFromThread(lastFiveSales(), ["Thomas"]);
    expect(continueOrderedQuery(memory, 5).members.map(m => m.label)).toEqual([
      "Dana",
      "Priya",
      "Marcus",
      "Lena",
    ]);
  });

  it("exclusion matches a spoken first name, not a position", () => {
    const memory = excludeFromThread(lastFiveSales(), ["dana"]);
    expect(remainingMembers(memory).some(m => m.label === "Dana")).toBe(false);
    expect(remainingMembers(memory).some(m => m.label === "Thomas")).toBe(true);
  });
});

describe("a new query resets exclusions", () => {
  it("an unrelated query drops the previous thread's exclusions", () => {
    const excludedThread = excludeFromThread(lastFiveSales(), ["Thomas"]);
    expect(excludedThread.exclusions).toEqual(["Thomas"]);

    const nextThread = openOrderedQuery({
      queryFingerprint: "top_customers:90d",
      parameters: { metric: "top_customers" },
      requestedCardinality: 5,
      ordering: "last",
      anchorEntity: null,
      resolved: FIVE,
    });
    const applied = resetForNewQuery(excludedThread, nextThread);

    expect(applied.exclusions).toEqual([]);
    expect(applied.presented).toEqual([]);
    expect(isSameQueryThread(excludedThread, nextThread.queryFingerprint)).toBe(false);
  });

  it("continuing the SAME query keeps its exclusions and presented set", () => {
    let thread = lastFiveSales();
    thread = recordPresented(thread, [FIVE[0]]);
    thread = excludeFromThread(thread, ["Dana"]);

    const sameAgain = openOrderedQuery({
      queryFingerprint: "latest_sales:5",
      parameters: { metric: "latest_sales", limit: 5 },
      requestedCardinality: 5,
      ordering: "last",
      anchorEntity: null,
      resolved: FIVE,
    });
    const applied = resetForNewQuery(thread, sameAgain);

    expect(applied.exclusions).toEqual(["Dana"]);
    expect(applied.presented.map(m => m.label)).toEqual(["Thomas"]);
    expect(continueOrderedQuery(applied, 4).members.map(m => m.label)).toEqual([
      "Priya",
      "Marcus",
      "Lena",
    ]);
  });
});
