import { describe, expect, it, vi } from "vitest";
import { commitBriefing } from "./briefingCommit";
import { parseBriefingDeterministically } from "./deterministicBriefing";
import { briefingClock } from "./briefingTiming";

const CLOCK = briefingClock(new Date("2026-09-21T16:00:00.000Z"), "America/Los_Angeles");

describe("commitBriefing no longer flattens every task to operations", () => {
  it("writes growth, prep, and operations from a mixed dump", async () => {
    const parsed = parseBriefingDeterministically(
      "Monday's priority is finishing the Zeely static Instagram ad. Wash my jacket for tomorrow. Drive to JETRO. Clean my bathroom.",
      CLOCK
    );
    const kinds: string[] = [];
    const roles: Array<string | null> = [];
    const accept = vi.fn(async (input: { proposal: { kind: string; command?: { role?: string | null } } }) => {
      kinds.push(input.proposal.kind);
      roles.push(input.proposal.command?.role ?? null);
      return { id: `id-${kinds.length}` };
    });
    await commitBriefing(
      parsed,
      { tenantId: "default", dayDirectorActorId: "1", conversationKey: "mix-1" },
      { accept: accept as never, complete: vi.fn() as never, update: vi.fn(async () => ({ ok: true as const, id: "x" })) as never }
    );
    expect(kinds).toContain("growth");
    expect(kinds).toContain("prep");
    expect(kinds).toContain("operations");
    expect(kinds.every(kind => kind === "operations")).toBe(false);
    expect(roles).toContain("housekeeping");
    expect(roles.filter(role => role === "primary")).toHaveLength(1);
  });

  it("preserves distinct multi-item briefing rows", async () => {
    const parsed = parseBriefingDeterministically(
      "John — I'm picking him up and dropping him off now. Lauren Jackson in Los Feliz. Then I need to go home and clean my bathroom. Then I have two dry-cleaning orders to drop off at Century Park East.",
      CLOCK
    );
    expect(parsed.items.length).toBeGreaterThanOrEqual(3);
    const accept = vi.fn(async () => ({ id: "x" }));
    await commitBriefing(
      parsed,
      { tenantId: "default", dayDirectorActorId: "1", conversationKey: "multi-1" },
      { accept: accept as never, complete: vi.fn() as never, update: vi.fn(async () => ({ ok: true as const, id: "x" })) as never }
    );
    expect(accept.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("routes unknown vehicle cargo through the cargo orchestrator instead of inventing a customer", async () => {
    const parsed = parseBriefingDeterministically(
      "I have another Century Park East dry-cleaning order in the car, but I can't remember the tenant's name.",
      CLOCK
    );
    expect(parsed.items.length).toBeGreaterThanOrEqual(1);
    const accept = vi.fn(async () => ({ id: "should-not-run" }));
    const linkVehicleWork = vi.fn(async () => ({
      cargo: { ok: true as const, id: "field-1", kind: "field" as const, duplicated: false },
      dayLine: { ok: true as const, id: "line-unknown" },
      receipts: [{ claimedState: "created" as const, entityId: "field-1", statement: "Recorded unlinked field cargo" }],
    }));
    const result = await commitBriefing(
      parsed,
      { tenantId: "default", dayDirectorActorId: "1", conversationKey: "cargo-1", vehicleId: "driver-1" },
      { accept: accept as never, complete: vi.fn() as never, update: vi.fn() as never, linkVehicleWork: linkVehicleWork as never }
    );
    expect(linkVehicleWork).toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
    expect(result.commitmentIds).toContain("line-unknown");
  });
});
