import { describe, expect, it } from "vitest";
import { formatGumballOperatorStatus } from "./gumballOperatorStatus";

describe("failed syncs stay failures", () => {
  it("does not relabel a failed extension sync as an export that was never captured", () => {
    const line = formatGumballOperatorStatus({
      lastAttemptAt: "2026-10-20T02:09:28.000Z",
      lastAttemptOutcome: "extension_failed",
    });
    expect(line).toContain("sync failed");
    expect(line).not.toContain("export never captured");
    expect(line).not.toMatch(/\$0|\b0 orders\b/);
  });

  it("says a missing Jawbreaker mailbox is a failed sync and not a zero", () => {
    const line = formatGumballOperatorStatus({
      lastAttemptAt: "2026-10-20T02:09:28.000Z",
      lastAttemptOutcome: "direct_auth_failed",
      lastAttemptMessage: "Jawbreaker Gmail is not connected for this tenant.",
    });
    expect(line).toContain(
      "sync failed because Jawbreaker Gmail is not connected"
    );
    expect(line).toContain("not a zero");
    expect(line).not.toContain("direct_auth_failed");
  });

  it("still names an export that never arrived", () => {
    expect(
      formatGumballOperatorStatus({
        lastAttemptAt: "2026-09-18T01:08:00.000Z",
        lastAttemptOutcome: "extension_export",
      })
    ).toContain("export never captured");
  });
});
