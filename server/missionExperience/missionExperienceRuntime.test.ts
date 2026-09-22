import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  advanceCompactToGate,
  applyAuthoritativeEvidence,
  applyClientGateAttempt,
  applyGameplayMutation,
  authorityKey,
  completeExperience,
  noteEntrance,
  noteHostPhase,
  readLockedWeeklyPrimary,
  type MissionExperienceInstance,
  type SelectedWorkRef,
} from "../../shared/missionExperience";
import { roleImage, visualPackageAllowsMission } from "../../shared/missionVisualPackage";
import type { MissionPlanOutcome } from "../../shared/missionDirector";
import type { WeeklyIntentRecord } from "../../shared/weeklyMissionReadiness";
import { weeklyIntentPrimaryCommandId } from "../claire/weeklyMission/dailyCommandIntent";
import { readAuthoritativeSelection } from "./readAuthoritativeSelection";
import {
  openMissionExperience,
  recordGameplay,
  resolveMissionExperience,
  resumeMissionExperience,
} from "./resolveMissionExperience";
import { createMemoryMissionExperienceStore } from "./missionExperienceStore";

const TENANT = "tenant-1";
const OPERATOR = "operator-1";
const DATE = "2026-09-22";
const NOW = "2026-09-22T15:00:00.000Z";

function ref(overrides: Partial<SelectedWorkRef> & Pick<SelectedWorkRef, "title" | "realObjective">): SelectedWorkRef {
  return {
    source: "daily_command",
    realGateKind: "MESSAGE_SENT",
    gateProducer: "message_ledger",
    playShape: "compact",
    dailyCommandItemId: "weekly-intent:2026-09-22",
    ...overrides,
  };
}

const louise = ref({
  source: "weekly_intent",
  title: "Visit the Louise",
  realObjective: "Visit the Louise",
  dailyCommandItemId: "weekly-intent:2026-09-22",
  realGateKind: "PHYSICAL_ARRIVAL",
  gateProducer: null,
  playShape: "rich_host",
  gameplayHost: "campaign_chapter",
});

const textCustomer = ref({
  source: "daily_command",
  title: "Text a dormant customer",
  realObjective: "Text a dormant customer",
  dailyCommandItemId: "follow-up:dormant-1",
  realGateKind: "MESSAGE_SENT",
  gateProducer: "message_ledger",
  playShape: "compact",
});

function base(selectedWorkRef: SelectedWorkRef, store = createMemoryMissionExperienceStore()) {
  return {
    tenantId: TENANT,
    operatorId: OPERATOR,
    businessDate: DATE,
    selectedWorkRef,
    store,
    nowIso: NOW,
  };
}

function lockedWeek(): WeeklyIntentRecord {
  return {
    id: "intent-1",
    tenantId: TENANT,
    operatorId: OPERATOR,
    weekStart: "2026-09-21",
    revision: 1,
    source: "operator_confirmed_proposal",
    lockedAt: "2026-09-21T12:00:00.000Z",
    days: [
      {
        businessDate: DATE,
        weekday: "Tuesday",
        disposition: "primary",
        primary: { text: "Visit the Louise", source: "operator_stated", commitmentId: null },
        fixedConstraints: [],
        readinessRequirements: [
          {
            text: "Print six packets",
            kind: "document",
            neededForDate: DATE,
            completeByDate: "2026-09-21",
            status: "open",
          },
        ],
      },
    ],
  };
}

function selection(title: string, objective: string) {
  return {
    campaignId: "camp-1",
    title,
    objective,
    completionCondition: "done",
    pocket: {
      startsAt: null,
      endsAt: null,
      minutes: 20,
      kind: "open_ended" as const,
      boundedBy: { before: null, after: null },
      travelReserveMinutes: 15,
      unknownStopWorkReserveMinutes: null,
      usableMinutes: 20,
      confidence: "high" as const,
      warnings: [],
    },
    isFallbackVariant: true,
    rankEvidence: {
      campaignId: "camp-1",
      score: 1,
      confidence: "low" as const,
      factors: [],
      warnings: [],
    },
  };
}

describe("mission experience runtime", () => {
  it("1-3 Day Line and Overworld share one instance and do not duplicate", async () => {
    const store = createMemoryMissionExperienceStore();
    const first = await resolveMissionExperience(base(textCustomer, store));
    const second = await resolveMissionExperience(base(textCustomer, store));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.instance.id).toBe(second.instance.id);
    expect(second.created).toBe(false);

    const fromDay = await openMissionExperience({
      instanceId: first.instance.id,
      entrance: "DAY_LINE",
      store,
      nowIso: NOW,
    });
    const fromWorld = await openMissionExperience({
      instanceId: first.instance.id,
      entrance: "OVERWORLD",
      store,
      nowIso: NOW,
    });
    expect(fromDay?.id).toBe(first.instance.id);
    expect(fromWorld?.id).toBe(first.instance.id);
    expect(fromWorld?.entrances).toEqual(["DAY_LINE", "OVERWORLD"]);

    const storeB = createMemoryMissionExperienceStore();
    const worldFirst = await resolveMissionExperience(base(textCustomer, storeB));
    if (!worldFirst.ok) throw new Error("expected instance");
    await openMissionExperience({
      instanceId: worldFirst.instance.id,
      entrance: "OVERWORLD",
      store: storeB,
      nowIso: NOW,
    });
    await openMissionExperience({
      instanceId: worldFirst.instance.id,
      entrance: "DAY_LINE",
      store: storeB,
      nowIso: NOW,
    });
    const again = await resolveMissionExperience(base(textCustomer, storeB));
    if (!again.ok) throw new Error("expected instance");
    expect(again.instance.id).toBe(worldFirst.instance.id);
    expect(again.created).toBe(false);
  });

  it("4-5 reload preserves identity and resumable progress", async () => {
    const store = createMemoryMissionExperienceStore();
    const opened = await resolveMissionExperience(base(textCustomer, store));
    if (!opened.ok) throw new Error("expected instance");
    const waiting = advanceCompactToGate(opened.instance, NOW);
    await store.update(waiting);
    const reloaded = await resolveMissionExperience(base(textCustomer, store));
    if (!reloaded.ok) throw new Error("expected instance");
    expect(reloaded.instance.id).toBe(opened.instance.id);
    expect(reloaded.instance.phase).toBe("WAITING_FOR_REAL_ACTION");
    const stayed = await resumeMissionExperience({
      instanceId: opened.instance.id,
      store,
      evidence: null,
      nowIso: NOW,
    });
    expect(stayed?.phase).toBe("WAITING_FOR_REAL_ACTION");
    const continued = await resumeMissionExperience({
      instanceId: opened.instance.id,
      store,
      nowIso: NOW,
      evidence: { gateKind: "MESSAGE_SENT", evidenceRef: "msg-1", producer: "message_ledger" },
    });
    expect(continued?.id).toBe(opened.instance.id);
    expect(continued?.phase).toBe("CONSEQUENCE_AVAILABLE");
    expect(continued?.realGate.state).toBe("SATISFIED");
  });

  it("6 existing host checkpoint is not reset", async () => {
    const hostSave = { guardianCleared: true, spanCrossed: false };
    const before = structuredClone(hostSave);
    const store = createMemoryMissionExperienceStore();
    const opened = await resolveMissionExperience(
      base(ref({ ...louise, gameplayHost: "wayward", playShape: "rich_host" }), store)
    );
    if (!opened.ok) throw new Error("expected instance");
    const recorded = await recordGameplay({
      instanceId: opened.instance.id,
      store,
      nowIso: NOW,
      checkpointRef: "goldline:fantasy:wayward:v1:operator-1",
      fictionalState: { visited: true },
      hostPhase: "span",
    });
    const again = await resolveMissionExperience(
      base(ref({ ...louise, gameplayHost: "wayward", playShape: "rich_host" }), store)
    );
    expect(hostSave).toEqual(before);
    expect(again.ok && again.instance.gameplay.checkpointRef).toBe(
      "goldline:fantasy:wayward:v1:operator-1"
    );
    expect(recorded?.gameplay.fictionalState).toEqual({ visited: true });
  });

  it("7-11 gameplay cannot satisfy a gate, and satisfaction needs a producer and evidence", async () => {
    const store = createMemoryMissionExperienceStore();
    const opened = await resolveMissionExperience(base(louise, store));
    if (!opened.ok) throw new Error("expected instance");
    const played = await recordGameplay({
      instanceId: opened.instance.id,
      store,
      nowIso: NOW,
      fictionalState: { radioTowerReached: true, doorOpen: true },
    });
    expect(played?.gameplay.fictionalState).toEqual({ radioTowerReached: true, doorOpen: true });
    expect(played?.realGate.state).toBe("UNAVAILABLE");
    const client = applyClientGateAttempt(played!);
    expect(client.realGate.state).toBe("UNAVAILABLE");
    const forged = applyAuthoritativeEvidence(
      played!,
      { gateKind: "PHYSICAL_ARRIVAL", evidenceRef: "gps-1", producer: "arrival_ledger" },
      NOW
    );
    expect(forged.realGate.state).toBe("UNAVAILABLE");
    expect(forged.realGate.evidenceRef).toBeNull();

    const waiting = ref({
      title: "Send the note",
      realObjective: "Send the note",
      dailyCommandItemId: "dc-note",
      realGateKind: "MESSAGE_DELIVERED",
      gateProducer: "message_ledger",
    });
    const gated = await resolveMissionExperience(base(waiting, store));
    if (!gated.ok) throw new Error("expected instance");
    const noRef = applyAuthoritativeEvidence(
      gated.instance,
      { gateKind: "MESSAGE_DELIVERED", evidenceRef: "   ", producer: "message_ledger" },
      NOW
    );
    expect(noRef.realGate.state).toBe("WAITING");
    const satisfied = applyAuthoritativeEvidence(
      gated.instance,
      { gateKind: "MESSAGE_DELIVERED", evidenceRef: "delivery-9", producer: "message_ledger" },
      NOW
    );
    expect(satisfied.realGate.state).toBe("SATISFIED");
    expect(satisfied.realGate.evidenceRef).toBe("delivery-9");
  });

  it("12-14 attempt, connection, and delivery stay distinct", () => {
    const attempted = applyAuthoritativeEvidence(
      blankFor(ref({
        title: "Call",
        realObjective: "Call the office",
        dailyCommandItemId: "call-1",
        realGateKind: "CALL_ATTEMPTED",
        gateProducer: "call_ledger",
      })),
      { gateKind: "CALL_ATTEMPTED", evidenceRef: "attempt-1", producer: "call_ledger" },
      NOW
    );
    expect(attempted.consequence.attemptReactionAvailable).toBe(true);
    expect(attempted.consequence.verifiedOutcomeObserved).toBe(false);
    expect(attempted.consequence.propertyApproval).toBe(false);

    const connected = applyAuthoritativeEvidence(
      blankFor(ref({
        title: "Call",
        realObjective: "Call the office",
        dailyCommandItemId: "call-2",
        realGateKind: "CALL_CONNECTED",
        gateProducer: "call_ledger",
      })),
      { gateKind: "CALL_CONNECTED", evidenceRef: "connect-1", producer: "call_ledger" },
      NOW
    );
    expect(connected.consequence.verifiedOutcomeObserved).toBe(true);
    expect(connected.consequence.propertyApproval).toBe(false);

    const deliveredGate = blankFor(ref({
      title: "Text",
      realObjective: "Text a dormant customer",
      dailyCommandItemId: "sms-1",
      realGateKind: "MESSAGE_DELIVERED",
      gateProducer: "message_ledger",
    }));
    const sentOnly = applyAuthoritativeEvidence(
      deliveredGate,
      { gateKind: "MESSAGE_SENT", evidenceRef: "msg-1", producer: "message_ledger" },
      NOW
    );
    expect(sentOnly.realGate.state).toBe("WAITING");
    expect(sentOnly.realGate.kind).toBe("MESSAGE_DELIVERED");
  });

  it("15-17 completion does not rewrite the week, designate a primary, or speak as Narrator", () => {
    const intent = lockedWeek();
    const frozen = structuredClone(intent);
    const done = completeExperience(
      {
        ...blankFor(textCustomer),
        realGate: { kind: "MESSAGE_SENT", state: "SATISFIED", evidenceRef: "msg-1", producer: "message_ledger" },
      },
      NOW
    );
    expect(done.status).toBe("COMPLETE");
    expect(intent).toEqual(frozen);
    expect(readLockedWeeklyPrimary(intent, DATE)?.text).toBe("Visit the Louise");
    const source = productionSource();
    expect(source).not.toMatch(/saveWeeklyIntent|insert\(weeklyIntents|demotePrimary|planForDate|selectMissionPlan|rankCampaigns|growthCandidate|anthropic|narratorOs|narrator/);
  });

  it("18-23 unreadiness keeps the locked mission and a supplied replacement is a second instance", async () => {
    const intent = lockedWeek();
    const frozen = structuredClone(intent);
    const store = createMemoryMissionExperienceStore();
    const opened = await resolveMissionExperience({
      ...base(louise, store),
      unreadiness: {
        notReady: true,
        missingPrepTexts: ["Print six packets"],
        existingFallback: textCustomer,
      },
    });
    if (!opened.ok) throw new Error("expected instance");
    expect(opened.instance.status).toBe("NOT_READY_TODAY");
    expect(opened.instance.title).toBe("Visit the Louise");
    expect(opened.instance.realObjective).toBe("Visit the Louise");
    expect(opened.instance.source).toBe("weekly_intent");
    expect(opened.instance.authorityRef.dailyCommandItemId).toBe("weekly-intent:2026-09-22");
    expect(opened.instance.id).toBe(opened.instance.id);
    expect(opened.replacement).not.toBeNull();
    expect(opened.replacement?.id).not.toBe(opened.instance.id);
    expect(opened.replacement?.title).toBe("Text a dormant customer");
    expect(opened.replacement?.replacement?.reason).toBe("ORIGINAL_MISSION_NOT_READY");
    expect(opened.replacement?.replacement?.replacesMissionInstanceId).toBe(opened.instance.id);
    expect(readLockedWeeklyPrimary(intent, DATE)).toEqual({
      text: "Visit the Louise",
      commitmentId: null,
    });
    expect(intent).toEqual(frozen);

    const reread = await resolveMissionExperience({
      ...base(louise, store),
      unreadiness: {
        notReady: true,
        missingPrepTexts: ["Print six packets"],
        existingFallback: textCustomer,
      },
    });
    if (!reread.ok) throw new Error("expected instance");
    expect(reread.created).toBe(false);
    expect(reread.replacement?.id).toBe(opened.replacement?.id);
  });

  it("24-28 the runtime only consumes an existing fallback and otherwise leaves replacement null", () => {
    const source = productionSource();
    expect(source).not.toMatch(/rankCampaigns|selectMissionPlan|growthCandidate|anthropic|messages\.create|claireTurn/);
    const day = lockedWeek().days[0]!;
    const none = readAuthoritativeSelection({
      businessDate: DATE,
      intentDay: day,
      commandPrimary: { id: "weekly-intent:2026-09-22", title: "Visit the Louise" },
      weeklyIntentOverride: null,
      plan: { id: "plan-1", outcome: { status: "no_plan", reason: "NO_PREPARED_FALLBACK", remedy: "none" } },
    });
    expect(none.unreadiness.notReady).toBe(true);
    expect(none.unreadiness.existingFallback).toBeNull();
    expect(none.original?.title).toBe("Visit the Louise");

    const prepFallback: MissionPlanOutcome = {
      status: "fallback_only",
      reason: "PREP_NOT_READY",
      explanation: "",
      ranking: [],
      fallback: selection("Print six packets", "Print six packets"),
    };
    const blocked = readAuthoritativeSelection({
      businessDate: DATE,
      intentDay: day,
      commandPrimary: null,
      weeklyIntentOverride: null,
      plan: { id: "plan-2", outcome: prepFallback },
    });
    expect(blocked.unreadiness.existingFallback).toBeNull();

    const legitimate: MissionPlanOutcome = {
      status: "fallback_only",
      reason: "PREP_NOT_READY",
      explanation: "",
      ranking: [],
      fallback: selection("Text a dormant customer", "Text a dormant customer"),
    };
    const consumed = readAuthoritativeSelection({
      businessDate: DATE,
      intentDay: day,
      commandPrimary: null,
      weeklyIntentOverride: null,
      plan: { id: "plan-existing", outcome: legitimate },
    });
    expect(consumed.unreadiness.existingFallback?.missionDirectorPlanId).toBe("plan-existing");
    expect(consumed.unreadiness.existingFallback?.missionDirectorSelection).toBe("fallback");
    expect(authorityKey(consumed.original!)).not.toBe(authorityKey(consumed.unreadiness.existingFallback!));
  });

  it("27 no fallback keeps replacement null on the instance", async () => {
    const opened = await resolveMissionExperience({
      ...base(louise),
      unreadiness: { notReady: true, missingPrepTexts: ["Print six packets"], existingFallback: null },
    });
    if (!opened.ok) throw new Error("expected instance");
    expect(opened.instance.status).toBe("NOT_READY_TODAY");
    expect(opened.replacement).toBeNull();
  });

  it("29 two selected-work items on one day do not collide", async () => {
    const store = createMemoryMissionExperienceStore();
    const first = await resolveMissionExperience(base(textCustomer, store));
    const second = await resolveMissionExperience(
      base(
        ref({
          title: "Log the follow-up",
          realObjective: "Log the follow-up",
          dailyCommandItemId: "follow-up:other",
          realGateKind: "FOLLOW_UP_LOGGED",
          gateProducer: "follow_up_ledger",
        }),
        store
      )
    );
    if (!first.ok || !second.ok) throw new Error("expected instances");
    expect(first.instance.id).not.toBe(second.instance.id);
    expect(first.instance.realObjective).toBe("Text a dormant customer");
    expect(second.instance.realObjective).toBe("Log the follow-up");
  });

  it("30-32 package and entrance do not change identity or business truth", async () => {
    const store = createMemoryMissionExperienceStore();
    const missing = await resolveMissionExperience(
      base(ref({ ...textCustomer, visualPackageId: null }), store)
    );
    if (!missing.ok) throw new Error("expected instance");
    expect(missing.instance.visualPackageId).toBeNull();
    expect(visualPackageAllowsMission(null)).toBe(true);
    expect(roleImage(null, "missionBriefHero")).toBeNull();
    const rebound = await resolveMissionExperience(
      base(ref({ ...textCustomer, visualPackageId: "pack-b" }), store)
    );
    if (!rebound.ok) throw new Error("expected instance");
    expect(rebound.instance.id).toBe(missing.instance.id);
    expect(rebound.instance.visualPackageId).toBe("pack-b");
    expect(rebound.instance.realObjective).toBe(missing.instance.realObjective);

    const opened = await openMissionExperience({
      instanceId: missing.instance.id,
      entrance: "OVERWORLD",
      store,
      nowIso: NOW,
    });
    expect(opened?.id).toBe(missing.instance.id);
    expect(opened?.realObjective).toBe("Text a dormant customer");
    expect(opened?.realGate).toEqual(rebound.instance.realGate);
    expect(opened?.status).toBe(rebound.instance.status);
    expect(opened?.source).toBe(rebound.instance.source);
    const noted = noteEntrance(rebound.instance, "DAY_LINE", NOW);
    expect(noted.realObjective).toBe(rebound.instance.realObjective);
    expect(noted.realGate).toEqual(rebound.instance.realGate);
  });

  it("34-36 compact play can skip phases, rich hosts keep theirs, and there is no reward economy", () => {
    const compact = advanceCompactToGate(blankFor(textCustomer), NOW);
    expect(compact.phase).toBe("WAITING_FOR_REAL_ACTION");
    expect(compact.gameplay.hostPhase).toBeNull();
    expect(OPTIONAL_PLAY_SKIPPED(compact)).toBe(true);

    let rich = blankFor(ref({
      ...louise,
      gameplayHost: "clockhead",
      playShape: "rich_host",
      dailyCommandItemId: "weekly-intent:2026-09-22",
    }));
    rich = noteHostPhase(rich, "3", NOW);
    expect(rich.gameplay.hostPhase).toBe("3");
    expect(rich.phase).toBe("PLAYABLE_BEFORE_GATE");
    rich = noteHostPhase(rich, "THE FINAL HOUR", NOW);
    expect(rich.gameplay.hostPhase).toBe("THE FINAL HOUR");
    rich = noteHostPhase(rich, "antagonist_comms", NOW);
    expect(rich.gameplay.hostPhase).toBe("antagonist_comms");
    const hostComplete = noteHostPhase(rich, "complete", NOW);
    expect(hostComplete.status).toBe("ACTIVE");
    expect(hostComplete.gameplay.hostPhase).toBe("complete");

    const rewarded = applyGameplayMutation(compact, { fictionalState: { xp: 10, coins: 4, door: true } }, NOW);
    expect(rewarded.gameplay.fictionalState).toEqual({ door: true });
    expect(JSON.stringify(rewarded)).not.toMatch(/"xp"|"coins"|"points"/);
  });

  it("fails closed without a Daily Command item or Mission Director plan id", async () => {
    const refused = await resolveMissionExperience(
      base(ref({
        title: "A run",
        realObjective: "A run",
        dailyCommandItemId: null,
        campaignRunId: "run-1",
        source: "mission_director",
      }))
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("NO_AUTHORITATIVE_IDENTITY");
  });

  it("uses the weekly primary command id the Daily Command projection already uses", () => {
    expect(weeklyIntentPrimaryCommandId(DATE, null)).toBe("weekly-intent:2026-09-22");
    expect(weeklyIntentPrimaryCommandId(DATE, "commit-9")).toBe("day-director:commit-9");
  });
});

function OPTIONAL_PLAY_SKIPPED(instance: MissionExperienceInstance): boolean {
  return instance.phase !== "PLAYABLE_BEFORE_GATE" && instance.phase !== "PLAYABLE_AFTER_GATE";
}

function blankFor(selected: SelectedWorkRef): MissionExperienceInstance {
  return {
    id: "local",
    tenantId: TENANT,
    operatorId: OPERATOR,
    businessDate: DATE,
    authorityRef: {
      authorityKey: authorityKey(selected) ?? "missing",
      dailyCommandItemId: selected.dailyCommandItemId ?? null,
      missionDirectorPlanId: selected.missionDirectorPlanId ?? null,
      missionDirectorSelection: selected.missionDirectorSelection ?? null,
      campaignRunId: null,
    },
    source: selected.source,
    title: selected.title,
    realObjective: selected.realObjective,
    status: "ACTIVE",
    phase: "BRIEFING",
    playShape: selected.playShape ?? "compact",
    gameplayHost: selected.gameplayHost ?? null,
    gameplay: { host: selected.gameplayHost ?? null, checkpointRef: null, hostPhase: null, fictionalState: null },
    realGate: {
      kind: selected.realGateKind,
      state: selected.gateProducer ? "WAITING" : "UNAVAILABLE",
      evidenceRef: null,
      producer: selected.gateProducer ?? null,
    },
    consequence: {
      attemptObserved: false,
      verifiedOutcomeObserved: false,
      attemptReactionAvailable: false,
      verifiedConsequenceAvailable: false,
      propertyApproval: false,
    },
    replacement: null,
    visualPackageId: selected.visualPackageId ?? null,
    entrances: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function productionSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const serverFiles = readdirSync(here)
    .filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map(name => readFileSync(join(here, name), "utf8"));
  const shared = readFileSync(join(here, "../../shared/missionExperience.ts"), "utf8");
  const visual = readFileSync(join(here, "../../shared/missionVisualPackage.ts"), "utf8");
  const client = readFileSync(
    join(here, "../../client/src/game/missionExperience/openMissionExperience.ts"),
    "utf8"
  );
  return [...serverFiles, shared, visual, client].join("\n");
}
