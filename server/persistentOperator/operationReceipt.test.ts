import { describe, expect, it } from "vitest";
import {
  isMissingOptionalReceiptTableError,
  optionalReceiptRows,
  selectValidatedAuthorityEvent,
  selectedObligationRef,
} from "./operationReceipt";

describe("operationReceipt authority lineage", () => {
  it("treats absent optional receipt tables as unresolved evidence instead of throwing", async () => {
    const missing = Object.assign(new Error("table does not exist"), {
      code: "ER_NO_SUCH_TABLE",
      errno: 1146,
    });
    expect(isMissingOptionalReceiptTableError(missing)).toBe(true);
    await expect(
      optionalReceiptRows(async () => {
        throw missing;
      })
    ).resolves.toEqual([]);
  });

  it("inspects wrapped causes when ORM wraps ER_NO_SUCH_TABLE", async () => {
    const inner = Object.assign(new Error("Table doesn't exist"), {
      code: "ER_NO_SUCH_TABLE",
      errno: 1146,
    });
    const wrapped = new Error("Query failed in Drizzle", { cause: inner });
    expect(isMissingOptionalReceiptTableError(wrapped)).toBe(true);
    await expect(
      optionalReceiptRows(async () => {
        throw wrapped;
      })
    ).resolves.toEqual([]);
  });

  it("does not swallow non-schema receipt query failures", async () => {
    const failure = Object.assign(new Error("connection lost"), {
      code: "PROTOCOL_CONNECTION_LOST",
    });
    expect(isMissingOptionalReceiptTableError(failure)).toBe(false);
    await expect(
      optionalReceiptRows(async () => {
        throw failure;
      })
    ).rejects.toThrow("connection lost");
  });

  it("does not resolve authority from an unvalidated proposal or policy denial", () => {
    const events = [
      {
        status: "proposed",
        operationStatus: "proposed",
        authorityBasis: null,
        approvalBasis: null,
        standingAuthorizationId: "auth-unvalidated",
      },
      {
        status: "policy_denied",
        operationStatus: "policy_denied",
        authorityBasis: null,
        approvalBasis: null,
        standingAuthorizationId: "auth-unvalidated",
      },
    ];
    expect(selectValidatedAuthorityEvent(events)).toBeUndefined();
  });

  it("does not resolve approval basis from a failure before policy validation", () => {
    const events = [
      {
        status: "failed",
        operationStatus: "failed",
        authorityBasis: null,
        approvalBasis: "explicit_approval",
      },
    ];
    expect(selectValidatedAuthorityEvent(events)).toBeUndefined();
  });

  it("keeps each decision linked to its originally selected obligation", () => {
    const first = {
      selectionKind: "obligation",
      selectedRef: "obligation-a",
    };
    const later = {
      selectionKind: "obligation",
      selectedRef: "obligation-a",
    };
    expect(selectedObligationRef(first)).toBe("obligation-a");
    expect(selectedObligationRef(later)).toBe("obligation-a");
    expect(
      selectedObligationRef({
        selectionKind: "candidate",
        selectedRef: "candidate-b",
      })
    ).toBeNull();
  });

  it("selects the first post-policy event carrying the validated authority basis", () => {
    const events = [
      {
        status: "proposed",
        operationStatus: "proposed",
        authorityBasis: null,
        approvalBasis: null,
      },
      {
        status: "execution_started",
        operationStatus: "execution_started",
        authorityBasis: "standing_authorization",
        approvalBasis: "standing_authorization",
      },
      {
        status: "success",
        operationStatus: "succeeded",
        authorityBasis: "standing_authorization",
        approvalBasis: "standing_authorization",
      },
    ];
    expect(selectValidatedAuthorityEvent(events)).toMatchObject({
      operationStatus: "execution_started",
      authorityBasis: "standing_authorization",
    });
  });

  it("handles missing PR5 receipt tables as unresolved without failing", async () => {
    const missing = Object.assign(new Error("Table doesn't exist"), {
      code: "ER_NO_SUCH_TABLE",
      errno: 1146,
    });
    expect(isMissingOptionalReceiptTableError(missing)).toBe(true);
    await expect(
      optionalReceiptRows(async () => {
        throw missing;
      })
    ).resolves.toEqual([]);
  });
});

