/**
 * Canonical Friday → Monday Daily Command scenario with fixture identities.
 * Exercises the derived command picture as a system, not isolated helpers.
 */
import { describe, expect, it, vi } from "vitest";
import { commitBriefing } from "./briefing/briefingCommit";
import { parseBriefingDeterministically } from "./briefing/deterministicBriefing";
import { briefingClock } from "./briefing/briefingTiming";
import { decorateCommitmentProposal } from "./voiceCommitmentLoop";
import { deriveDailyCommand, readCommandMetadata, UNKNOWN_CARGO_IDENTITY } from "../../shared/claireWorkdayCommand";
import { applyCommandProtection, detectTimePockets } from "../missionDirector/pocketDetection";
import { classifyDayDirectorKind } from "./workdayCommandKind";
import { detectUnknownCargoIdentity, resolveCommitmentBusinessDate } from "./workdayCommandLanguage";
import { cargoFieldsForUnknownIdentity } from "./workdayCargoOrchestrator";
import { shouldProjectRule } from "./workdayRecurrenceService";

const FRIDAY = "2026-09-18";
const MONDAY = "2026-09-21";
const fridayClock = briefingClock(new Date("2026-09-18T20:00:00.000Z"), "America/Los_Angeles");
const mondayClock = briefingClock(new Date("2026-09-21T16:30:00.000Z"), "America/Los_Angeles");

describe("canonical Monday Daily Command scenario", () => {
  it("Friday confirmation belongs to Monday as the sole growth primary", async () => {
    const spoken =
      "Monday's priority is finishing the Zeely static Instagram ad, sending it to my collaborator for approval, and being ready to launch Monday or Tuesday.";
    expect(resolveCommitmentBusinessDate(spoken, FRIDAY)).toBe(MONDAY);
    const parsed = parseBriefingDeterministically(spoken, fridayClock);
    expect(parsed.items.length).toBeGreaterThanOrEqual(1);
    expect(parsed.items.every(item => item.businessDate === MONDAY)).toBe(true);
    const accept = vi.fn(async (input: { businessDate: string; proposal: { kind: string; command?: { role?: string | null; promisedTo?: string | null }; targetBusinessDate?: string | null } }) => {
      expect(input.businessDate).toBe(MONDAY);
      expect(input.proposal.kind).toBe("growth");
      expect(input.proposal.command?.role).toBe("primary");
      return { id: "zeely-1" };
    });
    await commitBriefing(
      parsed,
      { tenantId: "fixture", dayDirectorActorId: "actor-1", conversationKey: "friday-call" },
      { accept: accept as never, complete: vi.fn() as never, update: vi.fn(async () => ({ ok: true as const, id: "x" })) as never }
    );
    expect(accept).toHaveBeenCalled();
    const decorated = decorateCommitmentProposal(
      {
        promptKey: "x",
        title: "Finish Zeely static Instagram ad",
        kind: "operations",
        quantity: null,
        sourceText: spoken,
        prerequisites: [],
        question: null,
        intelligence: "manual_fallback",
      },
      spoken,
      FRIDAY
    );
    expect(decorated.targetBusinessDate).toBe(MONDAY);
    expect(decorated.command?.role).toBe("primary");
  });

  it("Monday reconciliation picture keeps primary, fixed windows, prep, debt, cargo, and housekeeping", () => {
    const dump =
      "John — I'm picking him up and dropping him off now. Lauren Jackson in Los Feliz. Then I need to go home and clean my bathroom. Drive to JETRO. Find a cash register under $100. Wash my jacket for tomorrow. Print tomorrow's collateral.";
    const parsed = parseBriefingDeterministically(dump, mondayClock);
    expect(parsed.items.length).toBeGreaterThanOrEqual(4);

    const command = deriveDailyCommand({
      businessDate: MONDAY,
      actorId: "actor-1",
      commitments: [
        {
          id: "zeely-1",
          title: "Finish Zeely static Instagram ad",
          kind: "growth",
          status: "open",
          sourceText: "Monday's priority is finishing the Zeely static Instagram ad",
          detailState: "COMPLETE",
          scheduleKind: null,
          scheduleLabel: null,
          command: readCommandMetadata({ command: { role: "primary", promisedTo: "collaborator" } }),
        },
        ...parsed.items
          .filter(item => item.kind === "new_work")
          .map((item, index) => ({
            id: `dump-${index}`,
            title: item.title,
            kind: classifyDayDirectorKind(`${item.title} ${item.quote}`),
            status: "open" as const,
            sourceText: item.quote,
            detailState: item.needs ? ("NEEDS_DETAILS" as const) : ("COMPLETE" as const),
            scheduleKind: item.timing.kind === "none" ? null : "FLEXIBLE_WINDOW",
            scheduleLabel: item.timing.kind === "none" ? null : item.timing.label,
            command: readCommandMetadata({
              command: {
                role: /bathroom/i.test(item.quote) ? "housekeeping" : /jacket|collateral/i.test(item.quote) ? "tomorrow_prep" : null,
              },
            }),
          })),
      ],
      route: [
        {
          id: "existing-pickup",
          title: "Existing route pickup",
          kind: "pickup",
          scheduledAt: "2026-09-21T15:00:00.000Z",
          status: "open",
          sourceReference: "orders:existing",
        },
      ],
      cargo: [
        {
          id: "sophia",
          title: "Sophia dry cleaning",
          customerDisplayName: "Sophia",
          identityUnknown: false,
          unlinked: false,
          custodyLocation: "vehicle",
          linkedOrderId: 41,
          fieldCargoId: null,
          source: "order",
        },
        {
          id: "unknown",
          title: `Dry cleaning (${UNKNOWN_CARGO_IDENTITY})`,
          customerDisplayName: UNKNOWN_CARGO_IDENTITY,
          identityUnknown: true,
          unlinked: true,
          custodyLocation: "vehicle",
          linkedOrderId: null,
          fieldCargoId: "field-unknown",
          source: "field",
        },
      ],
      campaign: { active: true, remainingCount: 3, remainingProven: true, campaignName: "Colosseum" },
      followUps: [{ id: "louise", title: "The Louise follow-up", sourceReference: "accounts:louise", status: "open" }],
    });

    expect(command.primary?.id).toBe("day-director:zeely-1");
    expect(command.fixed.some(item => item.title === "Existing route pickup")).toBe(true);
    expect(command.tomorrowPrep.length).toBeGreaterThanOrEqual(1);
    expect(command.housekeeping.some(item => /bathroom/i.test(item.title))).toBe(true);
    expect(command.operations.some(item => /JETRO|register/i.test(item.title))).toBe(true);
    expect(command.growthDebt.some(item => /Louise/.test(item.title))).toBe(true);
    expect(command.growthDebt.some(item => item.title.includes("3 visits remaining"))).toBe(true);
    expect(command.cargo.filter(item => item.identityUnknown)).toHaveLength(1);
    expect(command.cargo.filter(item => !item.identityUnknown)).toHaveLength(1);
    expect(command.constraints.protectDiscretionary).toBe(true);

    const pockets = applyCommandProtection(
      detectTimePockets({
        timeline: [
          { id: "existing-pickup", title: "Existing route pickup", scheduledAt: "2026-09-21T15:00:00.000Z", kind: "pickup" },
          { id: "later", title: "Later stop", scheduledAt: "2026-09-21T18:00:00.000Z", kind: "delivery" },
        ],
      }),
      command.constraints.protectDiscretionary
    );
    expect(pockets.every(pocket => pocket.usableMinutes === 0)).toBe(true);

    expect(detectUnknownCargoIdentity("another Century Park East dry-cleaning order whose name I can't remember")).toBe(true);
    expect(cargoFieldsForUnknownIdentity({ transcript: "dry-cleaning, can't remember the tenant's name" }).customerDisplayName).toBe(
      UNKNOWN_CARGO_IDENTITY
    );
    expect(shouldProjectRule({ status: "active", weekday: "monday" }, "2026-09-28")).toBe(true);
    expect(shouldProjectRule({ status: "active", weekday: "monday" }, "2026-09-28")).toBe(true);
  });
});
