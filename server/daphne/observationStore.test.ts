import { describe, expect, it } from "vitest";
import {
  daphneObservationId,
  normalizeDaphneObservationInput,
} from "./observationStore";

describe("Daphne V2 immutable observation ledger", () => {
  const base = {
    tenantId: "tenant-a",
    canonicalOperatorId: "operator-a",
    actorType: "user" as const,
    observationKind: "preference_declaration" as const,
    evidenceChannel: "stated" as const,
    sourceType: "claire_conversation",
    sourceReference: "conversation:1:turn:2",
    occurredAt: "2026-10-07T08:00:00.000Z",
    idempotencyKey: "preference:1",
  };

  it("derives stable ids from tenant, operator and idempotency key", () => {
    expect(daphneObservationId(base)).toBe(daphneObservationId(base));
    expect(
      daphneObservationId({ ...base, canonicalOperatorId: "operator-b" })
    ).not.toBe(daphneObservationId(base));
    expect(
      daphneObservationId({ ...base, tenantId: "tenant-b" })
    ).not.toBe(daphneObservationId(base));
  });

  it("keeps stated evidence distinct from revealed behavior", () => {
    const stated = normalizeDaphneObservationInput({
      ...base,
      payload: { preference: "short responses" },
    });
    const revealed = normalizeDaphneObservationInput({
      ...base,
      observationKind: "user_action",
      evidenceChannel: "revealed",
      idempotencyKey: "action:1",
      sourceReference: "behavioral-ledger:99",
      payload: { action: "dismissed" },
    });

    expect(stated.evidenceChannel).toBe("stated");
    expect(revealed.evidenceChannel).toBe("revealed");
    expect(stated.id).not.toBe(revealed.id);
  });

  it("preserves authoritative business outcomes as references rather than business truth claims", () => {
    const observed = normalizeDaphneObservationInput({
      ...base,
      actorType: "external",
      observationKind: "verified_business_outcome",
      evidenceChannel: "authoritative_external",
      verificationStatus: "verified",
      idempotencyKey: "outcome:paid-order-7",
      sourceType: "order_payment_receipt",
      sourceReference: "payment-receipt:7",
      payload: { observedClass: "verified_business_outcome" },
    });

    expect(observed.sourceReference).toBe("payment-receipt:7");
    expect(observed.verificationStatus).toBe("verified");
    expect(observed.payloadJson).toEqual({
      observedClass: "verified_business_outcome",
    });
  });

  it("rejects missing identity and invalid timestamps instead of manufacturing evidence", () => {
    expect(() =>
      normalizeDaphneObservationInput({ ...base, tenantId: " " })
    ).toThrow(/tenantId/);
    expect(() =>
      normalizeDaphneObservationInput({ ...base, occurredAt: "not-a-date" })
    ).toThrow(/occurredAt/);
  });
});
