import { describe, expect, it, vi } from "vitest";
import { commitBriefing, speakBriefingCommit } from "./briefingCommit";
import { parseBriefingDeterministically } from "./deterministicBriefing";
import { briefingClock } from "./briefingTiming";
const scope = { tenantId: "tenant-a", dayDirectorActorId: "1", conversationKey: "oct11" };
const clock = briefingClock(new Date("2026-10-12T01:00:00Z"), "America/Los_Angeles");
const parsed = () => parseBriefingDeterministically("Call Ava tomorrow. Send Blake the estimate tomorrow.", clock);
function fixture(over: Record<string, unknown> = {}) {
  const rows = new Map<string, any>();
  const accept = vi.fn(async (input: any) => {
    const prior = [...rows.values()].find(row => row.idempotencyKey === input.proposal.promptKey);
    const row = prior ?? { id: `line-${rows.size + 1}`, tenantId: input.tenantId, actorId: input.actorId,
      businessDate: input.businessDate, title: input.proposal.title, idempotencyKey: input.proposal.promptKey,
      status: "open", metadataJson: { command: input.proposal.command }, ...over };
    rows.set(row.id, row);
    return { stored: row, created: !prior };
  });
  const readCanonical = vi.fn(async ({ commitmentId }: any) => rows.get(commitmentId) ?? null);
  return { rows, accept, readCanonical, ports: { accept: accept as never, readCanonical: readCanonical as never } };
}
describe("briefing canonical readback", () => {
  it("confirms two independently stored Monday items, exact count and numeric actor", async () => {
    const f = fixture();
    const result = await commitBriefing(parsed(), scope, f.ports);
    expect(result.added).toHaveLength(2);
    expect(speakBriefingCommit(result, "2026-10-11")).toBe("Added Call Ava for tomorrow. Added Send Blake the estimate for tomorrow.");
    expect(f.readCanonical).toHaveBeenCalledTimes(2);
    expect(f.readCanonical.mock.calls.every(([arg]) => arg.actorId === "1" && arg.businessDate === "2026-10-12" && arg.tenantId === "tenant-a")).toBe(true);
  });
  it.each([{ actorId: "67402" }, { tenantId: "foreign" }, { businessDate: "2026-10-11" }, { title: "Something else" }])("does not confirm a mismatching canonical row: %j", async mismatch => {
    const f = fixture(mismatch);
    const result = await commitBriefing(parsed(), scope, f.ports);
    expect(result.added).toHaveLength(0);
    expect(result.receipts).toHaveLength(0);
    expect(result.failed).toHaveLength(2);
    expect(speakBriefingCommit(result, "2026-10-11")).not.toMatch(/^Done\.|nothing saved/i);
  });
  it("a replay distinguishes already present rows from newly created rows", async () => {
    const f = fixture();
    await commitBriefing(parsed(), scope, f.ports);
    const replay = await commitBriefing(parsed(), scope, f.ports);
    expect(f.rows.size).toBe(2);
    expect(replay.added).toHaveLength(0);
    expect(replay.alreadyPresent).toHaveLength(2);
    expect(replay.receipts.every(receipt => receipt.claimedState !== "created")).toBe(true);
    expect(speakBriefingCommit(replay, "2026-10-11")).toBe("Already saved Call Ava for tomorrow. Already saved Send Blake the estimate for tomorrow.");
  });
  it("does not treat an attempted completion as verified completion", async () => {
    const f = fixture();
    const p = parsed(); p.items[0]!.kind = "completed";
    const result = await commitBriefing({ ...p, items: [p.items[0]!] }, scope, { ...f.ports, complete: vi.fn(async () => ({ ok: true, alreadyCompleted: false })) as never });
    expect(result.completed).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.receipts).toHaveLength(0);
  });
  it("fails closed in production code path when canonical DB readback is unavailable and never consults mock tracker", async () => {
    // Calling commitBriefing without injecting mock ports (the real production code path)
    // Production path must fail closed if canonical DB readback cannot verify the row
    const result = await commitBriefing(parsed(), scope);
    expect(result.added).toHaveLength(0);
    expect(result.receipts).toHaveLength(0);
    expect(result.failed).toHaveLength(2);
    expect(speakBriefingCommit(result, "2026-10-11")).toMatch(/couldn't verify the save/i);
  });
});
