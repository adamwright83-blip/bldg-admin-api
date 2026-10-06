import { describe, expect, it, vi } from "vitest";
import {
  commitAccountFollowUp,
  speakAccountFollowUpCommit,
  type PendingAccountFollowUp,
} from "./accountActions";

const pending: PendingAccountFollowUp = {
  accountId: 12,
  accountName: "The Louise",
  pipelineId: null,
  followUpId: null,
  previousDueAt: null,
  dueDate: "2026-10-08",
  note: "Front desk said Thursday.",
  requestId: "0123456789abcdef0123456789abcdef",
};

describe("Claire account follow-up domain port", () => {
  it("treats the Day Director receipt-bearing result as the write authority", async () => {
    const accept = vi.fn(async () => ({
      stored: { id: "day-line-1" } as never,
      created: true,
    }));

    const result = await commitAccountFollowUp(
      pending,
      {
        tenantId: "tenant-a",
        operatorUserId: "operator-a",
        dayDirectorActorId: "42",
        timeZone: "America/Los_Angeles",
      },
      { accept: accept as never }
    );

    expect(accept).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      pipelineSaved: false,
      dayLineSaved: true,
      dayLineCommitmentId: "day-line-1",
      errors: [],
    });
    expect(speakAccountFollowUpCommit(pending, result, "2026-10-06")).toContain(
      "Saved on"
    );
  });

  it("does not claim a Day Line save when the domain port returns no persisted entity", async () => {
    const accept = vi.fn(async () => ({
      stored: undefined,
      created: false,
    }));

    const result = await commitAccountFollowUp(
      pending,
      {
        tenantId: "tenant-a",
        operatorUserId: "operator-a",
        dayDirectorActorId: "42",
        timeZone: "America/Los_Angeles",
      },
      { accept: accept as never }
    );

    expect(result.dayLineSaved).toBe(false);
    expect(result.dayLineCommitmentId).toBeNull();
    expect(result.errors).toContain(
      "Day Line follow-up write returned no commitment id"
    );
    expect(speakAccountFollowUpCommit(pending, result, "2026-10-06")).toBe(
      "I understood it, but I couldn't save it. Nothing changed."
    );
  });
});
