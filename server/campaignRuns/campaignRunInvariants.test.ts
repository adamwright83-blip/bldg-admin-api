/**
 * THE INVARIANT, stated whole:
 *
 *   A 24-target run can never become complete except through 24 qualifying
 *   active target slots. Adding targets after start cannot change its frozen
 *   24. Replacing one target keeps it at 24. Every qualifying placement is
 *   backed by real, same-operator, same-session territory presence. No client
 *   can declare GPS truth, campaign failure, or completion.
 *
 * Each clause gets its own test. If any of these go green while the behavior
 * regresses, the test is wrong, not the invariant.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveRunProgress,
  PRESENCE_VALIDITY_MINUTES,
  type CampaignTargetEvent,
  type RunTargetSlot,
} from "../../shared/campaignRun";

const RUN = "run-24";
const TOTAL = 24;

const slots: RunTargetSlot[] = Array.from({ length: TOTAL }, (_, index) => ({
  campaignRunId: RUN,
  slotId: `slot-${index + 1}`,
  originalTargetId: `t${index + 1}`,
}));

function presence(eventId: string, occurredAt: string, operator = "op-1"): CampaignTargetEvent {
  return {
    eventId,
    campaignRunId: RUN,
    targetId: null,
    kind: "territory_presence",
    occurredAt,
    operatorUserId: operator,
    provenance: "device_location",
    epistemicState: "confirmed",
    supportingPresenceEventId: null,
    replacementTargetId: null,
    lat: 34.07,
    lng: -118.4,
    accuracyMeters: 10,
    note: null,
  };
}

function placement(
  targetId: string,
  occurredAt: string,
  presenceId: string | null,
  operator = "op-1"
): CampaignTargetEvent {
  return {
    eventId: `e-${targetId}-${occurredAt}`,
    campaignRunId: RUN,
    targetId,
    kind: "placement_reported",
    occurredAt,
    operatorUserId: operator,
    provenance: "operator_reported",
    epistemicState: "confirmed",
    supportingPresenceEventId: presenceId,
    replacementTargetId: null,
    lat: null,
    lng: null,
    accuracyMeters: null,
    note: null,
  };
}

/** A full, lawful 24 — one presence ping per batch, inside the window. */
function lawfulFull(): CampaignTargetEvent[] {
  const events: CampaignTargetEvent[] = [];
  for (let batch = 0; batch < 3; batch += 1) {
    const day = 16 + batch;
    const presenceId = `p${batch}`;
    events.push(presence(presenceId, `2026-09-${day}T17:00:00.000Z`));
    for (let index = 0; index < 8; index += 1) {
      const targetId = `t${batch * 8 + index + 1}`;
      events.push(
        placement(
          targetId,
          `2026-09-${day}T17:${String(5 + index).padStart(2, "0")}:00.000Z`,
          presenceId
        )
      );
    }
  }
  return events;
}

describe("a 24-target run completes only through 24 qualifying slots", () => {
  it("completes at exactly 24 lawful placements", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots,
      events: lawfulFull(),
    });
    expect(progress.total).toBe(24);
    expect(progress.qualified).toBe(24);
    expect(progress.complete).toBe(true);
  });

  it("does not complete at 23", () => {
    const events = lawfulFull().filter(
      event => !(event.kind === "placement_reported" && event.targetId === "t24")
    );
    const progress = deriveRunProgress({ campaignRunId: RUN, slots, events });
    expect(progress.qualified).toBe(23);
    expect(progress.complete).toBe(false);
  });

  it("cannot be completed by unqualified placements, however many", () => {
    const events: CampaignTargetEvent[] = [
      presence("p0", "2026-09-16T17:00:00.000Z"),
      ...slots.map(slot =>
        placement(slot.originalTargetId, "2026-09-16T17:05:00.000Z", null)
      ),
    ];
    const progress = deriveRunProgress({ campaignRunId: RUN, slots, events });
    expect(progress.qualified).toBe(0);
    expect(progress.complete).toBe(false);
    expect(progress.unqualifiedPlacements).toHaveLength(24);
  });
});

describe("the frozen 24 cannot be moved", () => {
  it("ignores targets added to the set after the run started", () => {
    /* The run's denominator is its snapshot. Extra slots simply do not exist
     * for a run that did not freeze them. */
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots,
      events: [
        ...lawfulFull(),
        placement("t25-added-later", "2026-09-18T17:05:00.000Z", "p2"),
      ],
    });
    expect(progress.total).toBe(24);
    expect(progress.complete).toBe(true);
    expect(progress.unqualifiedPlacements).toContainEqual({
      targetId: "t25-added-later",
      reason: "target_not_in_run",
    });
  });

  it("keeps 24 when a target is replaced, and reopens that slot", () => {
    const events: CampaignTargetEvent[] = [
      ...lawfulFull(),
      {
        eventId: "r1",
        campaignRunId: RUN,
        targetId: "t7",
        kind: "target_replaced",
        occurredAt: "2026-09-19T12:00:00.000Z",
        operatorUserId: "op-1",
        provenance: "operator_observed",
        epistemicState: "confirmed",
        supportingPresenceEventId: null,
        replacementTargetId: "t7b",
        lat: null,
        lng: null,
        accuracyMeters: null,
        note: "gated after all; no reachable placement point",
      },
    ];
    const progress = deriveRunProgress({ campaignRunId: RUN, slots, events });
    expect(progress.total).toBe(24);
    expect(progress.qualified).toBe(23);
    expect(progress.complete).toBe(false);

    const withReplacementPlaced = deriveRunProgress({
      campaignRunId: RUN,
      slots,
      events: [
        ...events,
        presence("p9", "2026-09-20T17:00:00.000Z"),
        placement("t7b", "2026-09-20T17:10:00.000Z", "p9"),
      ],
    });
    expect(withReplacementPlaced.total).toBe(24);
    expect(withReplacementPlaced.complete).toBe(true);
  });
});

describe("every qualifying placement is backed by real presence", () => {
  it("requires presence from the same operator, before it, and still valid", () => {
    const base = Date.parse("2026-09-16T17:00:00.000Z");
    const expired = new Date(base + (PRESENCE_VALIDITY_MINUTES + 5) * 60_000).toISOString();

    const cases: Array<[string, CampaignTargetEvent[]]> = [
      ["no presence at all", [placement("t1", "2026-09-16T17:05:00.000Z", null)]],
      [
        "other operator",
        [
          presence("p1", "2026-09-16T17:00:00.000Z", "op-2"),
          placement("t1", "2026-09-16T17:05:00.000Z", "p1", "op-1"),
        ],
      ],
      [
        "presence afterwards",
        [
          presence("p1", "2026-09-16T18:00:00.000Z"),
          placement("t1", "2026-09-16T17:05:00.000Z", "p1"),
        ],
      ],
      [
        "presence expired",
        [presence("p1", "2026-09-16T17:00:00.000Z"), placement("t1", expired, "p1")],
      ],
    ];

    for (const [label, events] of cases) {
      const progress = deriveRunProgress({ campaignRunId: RUN, slots, events });
      expect(progress.qualified, label).toBe(0);
    }
  });
});

describe("no client can declare GPS truth, failure, or completion", () => {
  const router = readFileSync(
    join(__dirname, "campaignRunRouter.ts"),
    "utf8"
  );
  const service = readFileSync(
    join(__dirname, "campaignRunService.ts"),
    "utf8"
  );

  it("exposes no endpoint that sets progress or completes a run", () => {
    expect(router).not.toMatch(/setProgress|markComplete|completeRun|setQualified/);
  });

  it("does not accept failure truth from the caller", () => {
    expect(router).not.toContain("failureConditionMet");
    expect(router).not.toContain("campaignHasFailureCondition");
    /* It is resolved from campaign truth on the server instead. */
    expect(service).toContain("resolveFailureTruth");
  });

  it("requires measured coordinates before it will record presence", () => {
    expect(router).toMatch(/lat: z\.number\(\)\.min\(-90\)\.max\(90\)/);
    expect(router).toMatch(/lng: z\.number\(\)\.min\(-180\)\.max\(180\)/);
    expect(service).toContain("checkTerritoryPresence");
  });

  it("does not let the caller choose the timestamp evidence is judged by", () => {
    const presenceBlock = router.slice(
      router.indexOf("recordPresence:"),
      router.indexOf("recordPlacement:")
    );
    expect(presenceBlock).not.toContain("occurredAt");
  });
});
