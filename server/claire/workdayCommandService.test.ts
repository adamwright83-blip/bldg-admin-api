import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveDailyCommand,
  gameBindingsForCommand,
  readCommandMetadata,
  toDailyCommandPromptSection,
  UNKNOWN_CARGO_IDENTITY,
  type CommandCommitmentSource,
} from "../../shared/claireWorkdayCommand";
import { applyCommandProtection, detectTimePockets } from "../missionDirector/pocketDetection";

function commitment(overrides: Partial<CommandCommitmentSource>): CommandCommitmentSource {
  return {
    id: "c1",
    title: "Work",
    kind: "operations",
    status: "open",
    sourceText: "work",
    detailState: "COMPLETE",
    scheduleKind: null,
    scheduleLabel: null,
    command: readCommandMetadata({ command: {} }),
    ...overrides,
  };
}

describe("Daily Command derivation", () => {
  const monday = deriveDailyCommand({
    businessDate: "2026-09-21",
    actorId: "1",
    commitments: [
      commitment({
        id: "zeely",
        title: "Finish Zeely static Instagram ad and send to collaborator",
        kind: "growth",
        sourceText: "Monday's priority is finishing the Zeely static Instagram ad",
        command: readCommandMetadata({
          command: {
            role: "primary",
            designatedBy: "operator",
            promisedTo: "Russell",
          },
        }),
      }),
      commitment({
        id: "clothes",
        title: "Wash jacket, dress shirt and jeans",
        kind: "prep",
        sourceText: "wash my jacket, dress shirt and jeans for tomorrow",
        command: readCommandMetadata({ command: { role: "tomorrow_prep" } }),
      }),
      commitment({
        id: "print",
        title: "Print tomorrow's collateral",
        kind: "prep",
        sourceText: "print tomorrow's collateral",
      }),
      commitment({
        id: "jetro",
        title: "Drive to JETRO",
        kind: "operations",
        sourceText: "drive to JETRO",
      }),
      commitment({
        id: "register",
        title: "Find a cash register under $100",
        kind: "operations",
        sourceText: "find a cash register under $100",
      }),
      commitment({
        id: "bathroom",
        title: "Clean bathroom",
        kind: "operations",
        sourceText: "clean my bathroom",
        command: readCommandMetadata({ command: { role: "housekeeping" } }),
      }),
    ],
    route: [
      {
        id: "pickup-existing",
        title: "Scheduled pickup already on the route",
        kind: "pickup",
        scheduledAt: "2026-09-21T15:00:00.000Z",
        status: "open",
        sourceReference: "orders:1",
      },
      {
        id: "john-missing-from-line",
        title: "John pickup/dropoff",
        kind: "pickup",
        scheduledAt: "2026-09-21T16:00:00.000Z",
        status: "open",
        sourceReference: "orders:john",
      },
      {
        id: "louise",
        title: "The Louise follow-up",
        kind: "follow_up",
        scheduledAt: null,
        status: "open",
        sourceReference: "accounts:louise",
      },
    ],
    cargo: [
      {
        id: "sophia",
        title: "Sophia cargo",
        customerDisplayName: "Sophia",
        identityUnknown: false,
        unlinked: false,
        custodyLocation: "vehicle",
        linkedOrderId: 88,
        fieldCargoId: null,
        source: "order",
      },
      {
        id: "unknown",
        title: `Dry cleaning in vehicle (${UNKNOWN_CARGO_IDENTITY})`,
        customerDisplayName: UNKNOWN_CARGO_IDENTITY,
        identityUnknown: true,
        unlinked: true,
        custodyLocation: "vehicle",
        linkedOrderId: null,
        fieldCargoId: "field-1",
        source: "field",
      },
    ],
    campaign: {
      active: true,
      remainingCount: 3,
      remainingProven: true,
      campaignName: "Colosseum",
    },
    followUps: [],
  });

  it("keeps Zeely as the sole primary and does not let housekeeping replace it", () => {
    expect(monday.primary?.title).toMatch(/Zeely/);
    expect(monday.housekeeping.map(item => item.title)).toEqual(["Clean bathroom"]);
    expect(monday.epistemic.executiveJudgment.discretionaryOwnerId).toBe(monday.primary?.id);
  });

  it("keeps importance and chronology as separate axes", () => {
    expect(monday.primary?.chronology.axis).toBe("unscheduled_discretionary");
    expect(monday.fixed.some(item => item.title === "John pickup/dropoff")).toBe(true);
    expect(monday.fixed.find(item => item.title === "John pickup/dropoff")?.chronology.axis).toBe("fixed_window");
  });

  it("keeps tomorrow prep, growth debt, and operations visible through a busy day", () => {
    expect(monday.tomorrowPrep.map(item => item.title)).toEqual([
      "Wash jacket, dress shirt and jeans",
      "Print tomorrow's collateral",
    ]);
    expect(monday.growthDebt.some(item => item.title.includes("Louise"))).toBe(true);
    expect(monday.growthDebt.some(item => item.title.includes("3 visits remaining"))).toBe(true);
    expect(monday.operations.map(item => item.title)).toEqual([
      "Drive to JETRO",
      "Find a cash register under $100",
    ]);
  });

  it("does not invent a campaign count without proven remaining visits", () => {
    const unproven = deriveDailyCommand({
      businessDate: "2026-09-21",
      actorId: "1",
      commitments: [],
      route: [],
      cargo: [],
      campaign: { active: true, remainingCount: 3, remainingProven: false, campaignName: "Colosseum" },
      followUps: [],
    });
    expect(unproven.growthDebt).toEqual([]);
  });

  it("exposes provenance for every category", () => {
    const buckets = [
      monday.primary,
      ...monday.fixed,
      ...monday.externalCommitments,
      ...monday.tomorrowPrep,
      ...monday.growthDebt,
      ...monday.operations,
      ...monday.housekeeping,
      ...monday.cargo,
    ].filter(Boolean);
    for (const item of buckets) {
      expect(item!.provenance.sourceIds.length).toBeGreaterThan(0);
      expect(item!.provenance.reader).toBeTruthy();
    }
  });

  it("keeps known cargo distinct from unknown field cargo", () => {
    expect(monday.cargo).toHaveLength(2);
    expect(monday.cargo.filter(item => item.identityUnknown)).toHaveLength(1);
    expect(monday.cargo.find(item => item.identityUnknown)?.cargoLink).toEqual({ kind: "field", id: "field-1" });
    expect(monday.cargo.find(item => !item.identityUnknown)?.cargoLink).toEqual({ kind: "order", id: "88" });
  });

  it("surfaces external promise context on the primary", () => {
    expect(monday.primary?.promisedTo).toBe("Russell");
  });

  it("does not consult Narrator OS", () => {
    const source = readFileSync(path.join(process.cwd(), "server/claire/workdayCommandService.ts"), "utf8");
    expect(source).not.toMatch(/narratorOs/);
    expect(toDailyCommandPromptSection(monday)).toMatch(/Narrator OS is not consulted/);
  });

  it("keeps a single primary when source data is dirty", () => {
    const dirty = deriveDailyCommand({
      businessDate: "2026-09-21",
      actorId: "1",
      commitments: [
        commitment({
          id: "zeely",
          title: "Finish Zeely ad",
          kind: "growth",
          command: readCommandMetadata({ command: { role: "primary" } }),
        }),
        commitment({
          id: "other",
          title: "Call Dana",
          kind: "growth",
          command: readCommandMetadata({ command: { role: "primary" } }),
        }),
      ],
      route: [],
      cargo: [],
      campaign: null,
      followUps: [],
    });
    expect(dirty.primary?.id).toBe("day-director:zeely");
  });

  it("only allows game skins on real work", () => {
    const bindings = gameBindingsForCommand(monday);
    expect(bindings.every(binding => binding.eligible && binding.reason === "real_work_exists")).toBe(true);
  });

  it("protects Mission Director discretionary pockets while primary or prep remain open", () => {
    expect(monday.constraints.protectDiscretionary).toBe(true);
    const pockets = applyCommandProtection(
      detectTimePockets({
        timeline: [
          { id: "p1", title: "Pickup", scheduledAt: "2026-09-21T15:00:00.000Z", kind: "pickup" },
          { id: "d1", title: "Delivery", scheduledAt: "2026-09-21T16:30:00.000Z", kind: "delivery" },
        ],
      }),
      monday.constraints.protectDiscretionary
    );
    expect(pockets[0]?.usableMinutes).toBe(0);
  });

  it("changes the constraint fingerprint when the primary changes", () => {
    const replaced = deriveDailyCommand({
      businessDate: "2026-09-21",
      actorId: "1",
      commitments: [
        commitment({
          id: "other",
          title: "Call Dana",
          kind: "growth",
          command: readCommandMetadata({ command: { role: "primary" } }),
        }),
      ],
      route: [],
      cargo: [],
      campaign: null,
      followUps: [],
    });
    expect(replaced.constraints.fingerprint).not.toBe(monday.constraints.fingerprint);
  });
});
