import { drizzle } from "drizzle-orm/mysql2";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ getDb: vi.fn() }));

import { getDb } from "../../db";
import {
  listCommercialFollowUpStates,
  listOpenCommercialFollowUps,
} from "./commercialFollowUpReadService";

/** A real drizzle query builder over a client that records the SQL and answers with `rows`. */
function recordingDb(answer: () => unknown[][]) {
  const sent: string[] = [];
  const client = {
    query: async (query: { sql: string }) => {
      sent.push(query.sql);
      return [answer(), []];
    },
  };
  return { db: drizzle({ client: client as never }), sent };
}

describe("commercial follow-up read service", () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReset();
  });

  it("names each open follow-up's account through its pipeline record, tenant to tenant", async () => {
    const { db, sent } = recordingDb(() => [
      ["follow-1", 42, "2026-11-02 17:00:00", "Email the revised quote.", "Larkspur Hotel"],
      ["follow-2", 43, "2026-11-03 17:00:00", "Call the GM.", null],
    ]);
    vi.mocked(getDb).mockResolvedValueOnce(db as never);

    const open = await listOpenCommercialFollowUps("tenant-a");

    expect(open).toEqual([
      {
        id: "follow-1",
        missionId: 42,
        dueAt: new Date("2026-11-02T17:00:00.000Z"),
        note: "Email the revised quote.",
        accountName: "Larkspur Hotel",
      },
      // A follow-up whose pipeline or account link is missing is still listed, unnamed.
      {
        id: "follow-2",
        missionId: 43,
        dueAt: new Date("2026-11-03T17:00:00.000Z"),
        note: "Call the GM.",
        accountName: null,
      },
    ]);
    const [statement] = sent;
    expect(statement).toContain(
      "left join `commercial_pipeline_records` on (`commercial_pipeline_records`.`tenantId` = `commercial_follow_ups`.`tenantId` and `commercial_pipeline_records`.`id` = `commercial_follow_ups`.`pipelineId`)"
    );
    expect(statement).toContain(
      "left join `commercial_accounts` on (`commercial_accounts`.`tenantId` = `commercial_pipeline_records`.`tenantId` and `commercial_accounts`.`id` = `commercial_pipeline_records`.`accountId`)"
    );
    expect(statement).toContain(
      "order by `commercial_follow_ups`.`dueAt` asc, `commercial_follow_ups`.`id` asc"
    );
  });

  it("reads the named follow-ups' current state, whatever it is", async () => {
    const { db, sent } = recordingDb(() => [
      ["follow-1", 42, "completed", "2026-11-02 17:00:00"],
      ["follow-2", 43, "open", "2026-11-05 17:00:00"],
    ]);
    vi.mocked(getDb).mockResolvedValueOnce(db as never);

    await expect(listCommercialFollowUpStates("tenant-a", ["follow-1", "follow-2", "follow-1"])).resolves.toEqual([
      { id: "follow-1", missionId: 42, status: "completed", dueAt: new Date("2026-11-02T17:00:00.000Z") },
      { id: "follow-2", missionId: 43, status: "open", dueAt: new Date("2026-11-05T17:00:00.000Z") },
    ]);
    expect(sent[0]).toContain("`commercial_follow_ups`.`tenantId` = ?");
    expect(sent[0]).toContain("`commercial_follow_ups`.`id` in (?, ?)");
  });

  it("asks nothing when no follow-up is named, and treats an unmigrated table as unknown", async () => {
    await expect(listCommercialFollowUpStates("tenant-a", [])).resolves.toEqual([]);
    expect(getDb).not.toHaveBeenCalled();

    const missing = Object.assign(new Error("Table doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
    const { db } = recordingDb(() => {
      throw missing;
    });
    vi.mocked(getDb).mockResolvedValueOnce(db as never);
    await expect(listCommercialFollowUpStates("tenant-a", ["follow-1"])).resolves.toBeNull();
  });
});
