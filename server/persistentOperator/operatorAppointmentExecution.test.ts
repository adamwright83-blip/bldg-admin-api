import { describe, expect, it } from "vitest";
import { requireClaireCallExecutionProof } from "./operatorAppointmentExecution";

describe("operator appointment execution proof", () => {
  it("requires both provider acceptance identity and durable communication receipt", () => {
    expect(
      requireClaireCallExecutionProof({
        callSid: "CA123",
        communicationReceiptId: "receipt-123",
      })
    ).toEqual({
      callSid: "CA123",
      communicationReceiptId: "receipt-123",
    });

    expect(() =>
      requireClaireCallExecutionProof({
        callSid: "CA123",
      })
    ).toThrow("no durable communication receipt");

    expect(() =>
      requireClaireCallExecutionProof({
        communicationReceiptId: "receipt-123",
      })
    ).toThrow("no call SID");

    expect(() => requireClaireCallExecutionProof(null)).toThrow("no call SID");
  });
});
