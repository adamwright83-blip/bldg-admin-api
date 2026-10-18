import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureAdamBoard = vi.fn(async () => ({ brief: "", created: 0 }));
vi.mock("../../claire/proactive/boardService", () => ({ ensureAdamBoard }));

const { listActiveDayLineItems } = await import("./dayLineMutationService");

/**
 * Reading the Day Line sweeps the proactive board, which reads the operator's
 * doctrine (their "no sales today") and files obligations by open id. Swept
 * under a Day Director actor id, the hold is never found and sales follow-ups
 * reach the Day Line on a held day, filed under the wrong operator.
 */
describe("the Day Line read sweeps the board only as the operator", () => {
  beforeEach(() => ensureAdamBoard.mockClear());

  it("never sweeps under a Day Director actor id", async () => {
    await listActiveDayLineItems({ tenantId: "tenant-a", actorId: "42", businessDate: "2026-10-19" }).catch(() => undefined);
    expect(ensureAdamBoard).not.toHaveBeenCalled();
  });

  it("sweeps under the operator's open id when it is known", async () => {
    await listActiveDayLineItems({ tenantId: "tenant-a", actorId: "42", operatorUserId: "open-adam", businessDate: "2026-10-19" }).catch(() => undefined);
    expect(ensureAdamBoard).toHaveBeenCalledWith({ tenantId: "tenant-a", operatorUserId: "open-adam", actorId: "42" });
  });
});
