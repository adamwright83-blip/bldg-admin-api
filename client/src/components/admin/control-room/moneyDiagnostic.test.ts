import { describe, expect, it } from "vitest";
import { nextMoneyDiagnostic } from "./ControlRoomSections";

describe("nextMoneyDiagnostic", () => {
  it("names the payment database when collected money was not read", () => {
    const result = nextMoneyDiagnostic({
      queryError: null,
      dbAvailable: false,
      clearentKnown: false,
      coverage: null,
    });
    expect(result?.source).toBe("payment-database");
    expect(result?.next).toContain("payment database");
  });

  it("names the failed source instead of calling a blank total zero", () => {
    const result = nextMoneyDiagnostic({
      queryError: null,
      dbAvailable: true,
      clearentKnown: true,
      coverage: {
        snapshotRead: true,
        failedSources: ["cleancloud"],
        affectedSources: [],
        incompleteForWindow: true,
      },
    });
    expect(result?.source).toBe("cleancloud");
    expect(result?.next).toContain("cleancloud");
    expect(result?.next.toLowerCase()).not.toContain("zero");
  });

  it("stays quiet when every collected source was read", () => {
    expect(nextMoneyDiagnostic({
      queryError: null,
      dbAvailable: true,
      clearentKnown: true,
      coverage: { snapshotRead: true, failedSources: [], affectedSources: [], incompleteForWindow: false },
    })).toBeNull();
  });
});
