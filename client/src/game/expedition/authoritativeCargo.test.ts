import { describe, expect, it } from "vitest";
import {
  isCollectedTruth,
  projectStrongholdRestoration,
  restorationDelta,
  STRONGHOLD_LANTERN_COUNT,
  type CollectedEvidenceOrder,
} from "./strongholdRestoration";

/**
 * REALITY WINS.
 *
 * The pickup is secured when the SERVER says the order is collected — not
 * when this client's mutation returned, and not when this client was the
 * one that fired it. Everything below pins that distinction down, because
 * it is the single rule the whole heartbeat rests on and it is the easiest
 * one to quietly break: an optimistic "the mutation resolved, show CARGO
 * SECURED" is indistinguishable from the correct behaviour on a good day
 * and a lie on a bad one.
 *
 * These tests drive the real projection used by the runtime. There is no
 * re-implementation here, and deliberately no mocked server: the evidence
 * collection IS the contract.
 */

const ORDER = 9300;

function evidence(
  ...rows: Array<[number, string]>
): readonly CollectedEvidenceOrder[] {
  return rows.map(([id, status]) => ({ id, status }));
}

function readingFor(orders: readonly CollectedEvidenceOrder[]) {
  return projectStrongholdRestoration({
    orders,
    expeditionOrderId: ORDER,
  });
}

describe("only authoritative evidence can secure the cargo", () => {
  it("does not consider a still-pending order collected", () => {
    const before = readingFor(evidence([ORDER, "new"]));
    expect(before.expeditionOrderCollected).toBe(false);
  });

  it("considers it collected once the server reports the transition", () => {
    const after = readingFor(evidence([ORDER, "collected"]));
    expect(after.expeditionOrderCollected).toBe(true);
  });

  it("accepts every status that is downstream of a real collection", () => {
    // An order cannot reach processing/ready/delivered without having been
    // collected, so each is proof the pickup genuinely happened.
    for (const status of ["collected", "processing", "ready", "delivered"]) {
      expect(readingFor(evidence([ORDER, status])).expeditionOrderCollected).toBe(
        true
      );
      expect(isCollectedTruth({ id: ORDER, status })).toBe(true);
    }
  });

  it("rejects statuses that are not proof of collection", () => {
    for (const status of ["new", "intake-pending", "cancelled"]) {
      expect(readingFor(evidence([ORDER, status])).expeditionOrderCollected).toBe(
        false
      );
      expect(isCollectedTruth({ id: ORDER, status })).toBe(false);
    }
  });

  it("does not secure THIS pickup because some OTHER order was collected", () => {
    const reading = readingFor(evidence([12345, "collected"], [ORDER, "new"]));
    expect(reading.expeditionOrderCollected).toBe(false);
    // The Stronghold still restores from the other real pickup — that is a
    // genuine collection and it genuinely counts.
    expect(reading.lanternsLit).toBe(1);
  });
});

describe("a pickup collected on another surface reconciles identically", () => {
  it("secures the cargo with no local mutation anywhere in the story", () => {
    // The player walks to the cache. Meanwhile a dispatcher marks the same
    // order collected on the admin surface. The next evidence poll arrives.
    // Nothing this client did caused the write.
    const before = readingFor(evidence([ORDER, "new"]));
    const afterSomeoneElseCollected = readingFor(evidence([ORDER, "collected"]));

    expect(before.expeditionOrderCollected).toBe(false);
    expect(afterSomeoneElseCollected.expeditionOrderCollected).toBe(true);

    const delta = restorationDelta(before, afterSomeoneElseCollected);
    expect(delta.expeditionOrderNewlyCollected).toBe(true);
    expect(delta.changed).toBe(true);
  });

  it("produces the same reading whoever performed the write", () => {
    // The projection has no notion of authorship, which is exactly why it
    // cannot treat "our" collection differently from anyone else's.
    const a = readingFor(evidence([ORDER, "collected"]));
    const b = readingFor(evidence([ORDER, "collected"]));
    expect(a).toEqual(b);
  });
});

describe("the pinned BEFORE reading is what makes the payoff honest", () => {
  it("shows a real gain against the state at ENTER", () => {
    const atEnter = readingFor(evidence([111, "delivered"], [ORDER, "new"]));
    const afterSecure = readingFor(
      evidence([111, "delivered"], [ORDER, "collected"])
    );

    const delta = restorationDelta(atEnter, afterSecure);
    expect(delta.lanternsGained).toBe(1);
    expect(delta.conduitGained).toBeGreaterThan(0);
    expect(delta.expeditionOrderNewlyCollected).toBe(true);
  });

  it("collapses to nothing if BEFORE is re-derived after the write", () => {
    // The bug this pinning exists to prevent. If the BEFORE reading were
    // recomputed from live evidence at payoff time, both sides would be the
    // post-write state and the delta would vanish exactly when the payoff
    // needs to show that something changed.
    const live = readingFor(evidence([ORDER, "collected"]));
    const wrong = restorationDelta(live, live);
    expect(wrong.changed).toBe(false);
    expect(wrong.lanternsGained).toBe(0);
  });

  it("fabricates nothing when the Stronghold is already fully restored", () => {
    // Six real collections already. A seventh must not invent a missing
    // segment to light up just so the moment has a flourish.
    const full = Array.from({ length: STRONGHOLD_LANTERN_COUNT }, (_, i) => ({
      id: 500 + i,
      status: "delivered",
    }));
    const atEnter = projectStrongholdRestoration({
      orders: full,
      expeditionOrderId: ORDER,
    });
    const afterSecure = projectStrongholdRestoration({
      orders: [...full, { id: ORDER, status: "collected" }],
      expeditionOrderId: ORDER,
    });

    expect(atEnter.lanternsLit).toBe(STRONGHOLD_LANTERN_COUNT);
    expect(afterSecure.lanternsLit).toBe(STRONGHOLD_LANTERN_COUNT);

    const delta = restorationDelta(atEnter, afterSecure);
    expect(delta.lanternsGained).toBe(0);
    expect(delta.conduitGained).toBe(0);
    // Still a true statement: THIS pickup is newly collected, even though
    // the threshold has no more lanterns left to light.
    expect(delta.expeditionOrderNewlyCollected).toBe(true);
  });
});

describe("the payoff survives a reload because it was never stored", () => {
  it("reconstructs the identical threshold from the same order truth", () => {
    const orders = evidence(
      [101, "collected"],
      [102, "processing"],
      [103, "delivered"],
      [ORDER, "collected"]
    );

    // "Before the reload" and "after the reload" differ only in that the
    // second reading has no memory of the first. Same orders in, same
    // Stronghold out.
    const beforeReload = readingFor(orders);
    const afterReload = readingFor([...orders]);

    expect(afterReload).toEqual(beforeReload);
    expect(afterReload.lanternsLit).toBe(4);
    expect(afterReload.expeditionOrderCollected).toBe(true);
  });

  it("does not depend on the order the evidence happens to arrive in", () => {
    const forwards = readingFor(
      evidence([101, "collected"], [102, "ready"], [ORDER, "delivered"])
    );
    const backwards = readingFor(
      evidence([ORDER, "delivered"], [102, "ready"], [101, "collected"])
    );
    expect(backwards).toEqual(forwards);
  });

  it("counts each real order once even if several queries return it", () => {
    // The evidence collection is a union of four status queries. A row
    // appearing twice must not light two lanterns.
    const duplicated = readingFor(
      evidence([101, "collected"], [101, "collected"], [ORDER, "collected"])
    );
    expect(duplicated.lanternsLit).toBe(2);
    expect(duplicated.restoredCount).toBe(2);
  });

  it("reverts honestly if the server says the collection was undone", () => {
    // Nothing here latches. If authoritative truth stops saying collected,
    // the Stronghold stops saying it too — a local ledger could not do this.
    const secured = readingFor(evidence([ORDER, "collected"]));
    const reverted = readingFor(evidence([ORDER, "new"]));
    expect(secured.expeditionOrderCollected).toBe(true);
    expect(reverted.expeditionOrderCollected).toBe(false);
    expect(reverted.lanternsLit).toBe(0);
  });
});

describe("the Stronghold reading carries no business detail", () => {
  it("needs only id and status to project the whole payoff", () => {
    const reading = readingFor(evidence([ORDER, "collected"]));
    expect(Object.keys(reading).sort()).toEqual([
      "collectedWithoutAuditEvent",
      "conduitCharge",
      "expeditionOrderCollected",
      "lanternsLit",
      "marksPresented",
      "restoredCount",
    ]);
  });

  it("never exceeds the six physical lanterns that exist", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: i,
      status: "delivered",
    }));
    const reading = projectStrongholdRestoration({ orders: many });
    expect(reading.lanternsLit).toBe(STRONGHOLD_LANTERN_COUNT);
    expect(reading.conduitCharge).toBe(1);
    // The real count is still reported truthfully underneath.
    expect(reading.restoredCount).toBe(40);
  });
});
