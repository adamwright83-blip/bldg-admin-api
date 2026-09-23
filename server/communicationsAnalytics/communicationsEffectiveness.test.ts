import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUSINESS_OUTCOMES_NOT_IMPLIED_BY_COMMUNICATIONS,
  providerSidIsGoldlineEntityId,
} from "@shared/twilioPlatform";
import {
  CALL_SESSION_GROUPING_RULE,
  COMMUNICATIONS_BANNED_UI_LABELS,
  COMMUNICATIONS_BUSINESS_SOURCES,
  COMMUNICATIONS_UI_DISCLAIMER,
  communicationContextLinkIdempotencyKey,
  observedRate,
} from "@shared/communicationsAnalytics";
import {
  communicationEvidenceImpliesBusinessOutcome,
  toCommunicationCandidateEvidence,
} from "../twilioPlatform/communicationEvidence";
import { buildTwilioCommunicationReceipt } from "../twilioPlatform/communicationReceipts";
import { getDashboardTimeZone } from "../dashboardZoned";
import { CALL_SESSION_GROUPING_RULE as GROUPING_FROM_MODULE, groupCallSessions } from "./callSessionGrouping";
import { buildCommunicationContextLink, CommunicationContextLinkError } from "./contextLinks";
import { getCommunicationsObservationWindow } from "./observationWindow";
import { projectCommunicationsEffectiveness } from "./projectSummary";
import type { CommunicationsProjectionFacts } from "./records";

const TENANT = "tenant-analytics";
const OTHER = "tenant-other";
const NOW = new Date("2026-09-22T16:00:00.000Z");
const TZ = "America/Los_Angeles";

function windowDays(days: 7 | 30 | 90) {
  return getCommunicationsObservationWindow({
    windowDays: days,
    now: NOW,
    timeZone: TZ,
  });
}

function receipt(
  input: Parameters<typeof buildTwilioCommunicationReceipt>[0]
) {
  return buildTwilioCommunicationReceipt({
    tenantId: TENANT,
    createdAt: "2026-09-20T18:00:00.000Z",
    ...input,
  });
}

function emptyFacts(
  partial: Partial<CommunicationsProjectionFacts> = {}
): CommunicationsProjectionFacts {
  return {
    tenantId: TENANT,
    receipts: [],
    claireSessions: [],
    contextLinks: [],
    acquisitions: [],
    orderAttributions: [],
    paymentProjections: [],
    orders: [],
    ...partial,
  };
}

function project(
  partial: Partial<CommunicationsProjectionFacts> = {},
  days: 7 | 30 | 90 = 30
) {
  return projectCommunicationsEffectiveness({
    facts: emptyFacts(partial),
    observationWindow: windowDays(days),
  });
}

function fourEventCall(callSid: string, extra?: Parameters<typeof receipt>[0]) {
  const base = {
    callSid,
    direction: "outbound" as const,
    from: "+13105550100",
    to: "+13105550101",
    ...extra,
  };
  return [
    receipt({ ...base, eventType: "CALL_ATTEMPTED", createdAt: "2026-09-20T18:00:00.000Z" }),
    receipt({ ...base, eventType: "CALL_RINGING", createdAt: "2026-09-20T18:00:01.000Z" }),
    receipt({
      ...base,
      eventType: "CALL_CONNECTED",
      durationSeconds: 120,
      createdAt: "2026-09-20T18:00:05.000Z",
    }),
    receipt({
      ...base,
      eventType: "CALL_COMPLETED",
      durationSeconds: 120,
      createdAt: "2026-09-20T18:02:05.000Z",
    }),
  ];
}

describe("1-9 resource/event dedupe", () => {
  it("1. event rows are not resources: four events on one CallSid count as one attempted call", () => {
    const summary = project({ receipts: fourEventCall("CA_one") });
    expect(summary.communications.all.voice.uniqueSessionsAttempted).toBe(1);
    expect(summary.communications.all.voice.uniqueSessionsRinging).toBe(1);
    expect(summary.communications.all.voice.uniqueSessionsConnected).toBe(1);
    expect(summary.communications.all.voice.uniqueSessionsCompleted).toBe(1);
  });

  it("2. one CallSid with ATTEMPTED/RINGING/CONNECTED/COMPLETED is one call", () => {
    const summary = project({ receipts: fourEventCall("CA_same") });
    expect(summary.communications.all.voice.uniqueSessionsAttempted).toBe(1);
    expect(
      summary.communications.all.voice.uniqueSessionsAttempted +
        summary.communications.all.voice.uniqueSessionsConnected
    ).not.toBe(8);
  });

  it("3. two CallSids are two call sessions", () => {
    const summary = project({
      receipts: [...fourEventCall("CA_a"), ...fourEventCall("CA_b")],
    });
    expect(summary.communications.all.voice.uniqueSessionsAttempted).toBe(2);
  });

  it("4. unique human-call session buckets count each terminal class once per session", () => {
    const summary = project({
      receipts: [
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_na" }),
        receipt({ eventType: "CALL_NO_ANSWER", callSid: "CA_na" }),
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_busy" }),
        receipt({ eventType: "CALL_BUSY", callSid: "CA_busy" }),
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_fail" }),
        receipt({ eventType: "CALL_FAILED", callSid: "CA_fail" }),
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_vm" }),
        receipt({ eventType: "VOICEMAIL_DETECTED", callSid: "CA_vm" }),
      ],
    });
    expect(summary.communications.all.voice.uniqueSessionsNoAnswer).toBe(1);
    expect(summary.communications.all.voice.uniqueSessionsBusy).toBe(1);
    expect(summary.communications.all.voice.uniqueSessionsFailed).toBe(1);
    expect(summary.communications.all.voice.uniqueSessionsVoicemailDetected).toBe(1);
  });

  it("5. observed connected duration uses provider durationSeconds and does not fabricate", () => {
    const summary = project({
      receipts: [
        receipt({
          eventType: "CALL_ATTEMPTED",
          callSid: "CA_dur",
        }),
        receipt({
          eventType: "CALL_CONNECTED",
          callSid: "CA_dur",
          durationSeconds: 224,
        }),
      ],
    });
    expect(summary.communications.all.voice.observedConnectedDurationSeconds).toBe(224);
    expect(summary.communications.all.voice.observedConnectedDurationMinutes).toBe(224 / 60);
  });

  it("6. average and median connected duration are computed from observed values", () => {
    const summary = project({
      receipts: [
        receipt({ eventType: "CALL_CONNECTED", callSid: "CA_1", durationSeconds: 100 }),
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_1" }),
        receipt({ eventType: "CALL_CONNECTED", callSid: "CA_2", durationSeconds: 200 }),
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_2" }),
        receipt({ eventType: "CALL_CONNECTED", callSid: "CA_3", durationSeconds: 300 }),
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_3" }),
      ],
    });
    expect(summary.communications.all.voice.averageConnectedDurationSeconds).toBe(200);
    expect(summary.communications.all.voice.medianConnectedDurationSeconds).toBe(200);
  });

  it("7. connection rate is connected/attempted", () => {
    const summary = project({
      receipts: [
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_ok" }),
        receipt({ eventType: "CALL_CONNECTED", callSid: "CA_ok", durationSeconds: 10 }),
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_miss" }),
        receipt({ eventType: "CALL_NO_ANSWER", callSid: "CA_miss" }),
      ],
    });
    expect(summary.communications.all.voice.connectionRate).toBe(0.5);
  });

  it("8. completion rate is completed/attempted", () => {
    const summary = project({
      receipts: [
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_done" }),
        receipt({ eventType: "CALL_COMPLETED", callSid: "CA_done", durationSeconds: 10 }),
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_open" }),
      ],
    });
    expect(summary.communications.all.voice.completionRate).toBe(0.5);
  });

  it("9. rate with zero denominator returns null, never fabricated 0% or 100%", () => {
    const empty = project();
    expect(empty.communications.all.voice.connectionRate).toBeNull();
    expect(empty.communications.all.voice.completionRate).toBeNull();
    expect(empty.communications.all.messaging.deliveryRate).toBeNull();
    expect(observedRate(0, 0)).toBeNull();
    expect(observedRate(0, 4)).toBe(0);
    expect(observedRate(4, 4)).toBe(1);
  });
});

describe("10-16 party class", () => {
  it("10. direction alone does not classify a party", () => {
    const summary = project({
      receipts: [
        receipt({
          eventType: "CALL_ATTEMPTED",
          callSid: "CA_dir",
          direction: "outbound",
          from: "+13105550100",
          to: "+13105550999",
        }),
      ],
    });
    expect(summary.partyClassification.unknown).toBe(1);
    expect(summary.partyClassification.operator_to_external).toBe(0);
    expect(summary.dataQuality.unknownPartyClassCount).toBe(1);
  });

  it("11. Claire session + outbound is claire_to_operator", () => {
    const summary = project({
      receipts: fourEventCall("CA_claire_out"),
      claireSessions: [
        {
          tenantId: TENANT,
          providerCallSid: "CA_claire_out",
          claireConversationId: "conv-out",
          missionId: null,
          relatedActionIds: [],
          operatorUserId: "adam-admin",
          startedAt: "2026-09-20T18:00:00.000Z",
        },
      ],
    });
    expect(summary.partyClassification.claire_to_operator).toBe(1);
    expect(summary.dataQuality.internalOperatorCommunicationCount).toBe(1);
  });

  it("12. Claire session + inbound is operator_to_claire", () => {
    const summary = project({
      receipts: [
        receipt({
          eventType: "CALL_ATTEMPTED",
          callSid: "CA_in",
          direction: "inbound",
        }),
        receipt({
          eventType: "CALL_COMPLETED",
          callSid: "CA_in",
          direction: "inbound",
          durationSeconds: 40,
        }),
      ],
      claireSessions: [
        {
          tenantId: TENANT,
          providerCallSid: "CA_in",
          claireConversationId: "conv-in",
          missionId: null,
          relatedActionIds: [],
          operatorUserId: "adam-admin",
          startedAt: "2026-09-20T18:00:00.000Z",
        },
      ],
    });
    expect(summary.partyClassification.operator_to_claire).toBe(1);
  });

  it("13. sendOperatorArtifact SMS is system_to_operator internal, never customer messaging", () => {
    const summary = project({
      receipts: [
        receipt({
          eventType: "MESSAGE_SENT",
          messageSid: "SM_artifact",
          direction: "outbound",
          from: "+13105550022",
          to: "+13105550001",
        }),
      ],
      contextLinks: [
        {
          tenantId: TENANT,
          providerResourceSid: "SM_artifact",
          resourceKind: "message",
          partyClass: "system_to_operator",
          goldlineEntityKind: "operator",
          goldlineEntityId: "adam-admin",
          source: "direct_provider_link",
          proof: "sendOperatorArtifact SMS to authorizedOperatorPhone; destination is not caller-supplied",
        },
      ],
    });
    expect(summary.partyClassification.system_to_operator).toBe(1);
    expect(summary.partyClassification.external_customer).toBe(0);
    expect(summary.dataQuality.internalOperatorCommunicationCount).toBe(1);
    expect(summary.dataQuality.externalCommunicationCount).toBe(0);
  });

  it("14. authorized operator calling Claire is internal", () => {
    const summary = project({
      receipts: [
        receipt({
          eventType: "CALL_COMPLETED",
          callSid: "CA_op",
          direction: "inbound",
          durationSeconds: 12,
        }),
      ],
      claireSessions: [
        {
          tenantId: TENANT,
          providerCallSid: "CA_op",
          claireConversationId: "conv-op",
          missionId: 9,
          relatedActionIds: [],
          operatorUserId: "adam-admin",
          startedAt: "2026-09-20T18:00:00.000Z",
        },
      ],
    });
    expect(summary.dataQuality.internalOperatorCommunicationCount).toBe(1);
    expect(summary.communications.internalOperatorClaire.voice.uniqueSessionsCompleted).toBe(1);
  });

  it("15. matching phones do not create an external or customer class", () => {
    const summary = project({
      receipts: [
        receipt({
          eventType: "CALL_ATTEMPTED",
          callSid: "CA_phone",
          direction: "outbound",
          from: "+13105550100",
          to: "+13105550999",
        }),
      ],
    });
    expect(summary.partyClassification.unknown).toBe(1);
    expect(summary.partyClassification.external_customer).toBe(0);
  });

  it("16. investor metrics distinguish all / internal / external / unknown", () => {
    const summary = project({
      receipts: [
        ...fourEventCall("CA_int"),
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_unk" }),
        receipt({
          eventType: "CALL_ATTEMPTED",
          callSid: "CA_ext",
          direction: "outbound",
        }),
      ],
      claireSessions: [
        {
          tenantId: TENANT,
          providerCallSid: "CA_int",
          claireConversationId: "conv-int",
          missionId: null,
          relatedActionIds: [],
          operatorUserId: "adam-admin",
          startedAt: "2026-09-20T18:00:00.000Z",
        },
      ],
      contextLinks: [
        {
          tenantId: TENANT,
          providerResourceSid: "CA_ext",
          resourceKind: "call",
          partyClass: "operator_to_external",
          goldlineEntityKind: "customer",
          goldlineEntityId: "cust-1",
          source: "explicit_order_link",
          proof: "canonical commercial customer on explicit_order_link",
        },
      ],
    });
    expect(summary.communications.all.voice.uniqueSessionsAttempted).toBe(3);
    expect(summary.communications.internalOperatorClaire.voice.uniqueSessionsAttempted).toBe(1);
    expect(summary.communications.provenExternal.voice.uniqueSessionsAttempted).toBe(1);
    expect(summary.communications.unknown.voice.uniqueSessionsAttempted).toBe(1);
    expect(summary.partyClassification.external_customer).toBe(1);
  });
});

describe("17-22 tenant/window", () => {
  it("17. windows are 7/30/90 days and default 30", () => {
    expect(project().observationWindow.windowDays).toBe(30);
    expect(project({}, 7).observationWindow.windowDays).toBe(7);
    expect(project({}, 90).observationWindow.windowDays).toBe(90);
  });

  it("18. observation window uses the provided dashboard timezone, not a hardcoded UTC day", () => {
    const observation = windowDays(7);
    expect(observation.timeZone).toBe(TZ);
    expect(observation.startUtc).toBe("2026-09-16T07:00:00.000Z");
    expect(observation.endExclusiveUtc).toBe("2026-09-23T07:00:00.000Z");
  });

  it("19. analytics source does not hard-code America/Los_Angeles", () => {
    const files = [
      "server/communicationsAnalytics/observationWindow.ts",
      "server/communicationsAnalytics/projectSummary.ts",
      "server/communicationsAnalytics/communicationsEffectiveness.ts",
      "server/communicationsAnalytics/queries.ts",
    ];
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toContain("America/Los_Angeles");
    }
    expect(getDashboardTimeZone()).toBeTruthy();
  });

  it("20. 30 days are 30 Goldline/admin business calendar days in the dashboard timezone", () => {
    const observation = windowDays(30);
    expect(observation.startUtc).toBe("2026-08-24T07:00:00.000Z");
    expect(observation.endExclusiveUtc).toBe("2026-09-23T07:00:00.000Z");
  });

  it("21. DB bounds are exact UTC instants and exclude the exclusive end", () => {
    const inside = receipt({
      eventType: "CALL_ATTEMPTED",
      callSid: "CA_in_bound",
      createdAt: "2026-09-23T06:59:59.000Z",
    });
    const outside = receipt({
      eventType: "CALL_ATTEMPTED",
      callSid: "CA_out_bound",
      createdAt: "2026-09-23T07:00:00.000Z",
    });
    const summary = project({ receipts: [inside, outside] }, 7);
    expect(summary.communications.all.voice.uniqueSessionsAttempted).toBe(1);
  });

  it("22. UTC calendar date is not the dashboard date: Sep 16 06:30Z is still Sep 15 in LA", () => {
    const utcSameDay = receipt({
      eventType: "CALL_ATTEMPTED",
      callSid: "CA_utc_mismatch",
      createdAt: "2026-09-16T06:30:00.000Z",
    });
    const laStart = receipt({
      eventType: "CALL_ATTEMPTED",
      callSid: "CA_la_start",
      createdAt: "2026-09-16T07:00:00.000Z",
    });
    const summary = project({ receipts: [utcSameDay, laStart] }, 7);
    expect(summary.communications.all.voice.uniqueSessionsAttempted).toBe(1);
    expect(summary.observationWindow.startUtc).toBe("2026-09-16T07:00:00.000Z");
    expect(summary.observationWindow.endExclusiveUtc).toBe("2026-09-23T07:00:00.000Z");
    expect(summary.observationWindow.timeZone).toBe(TZ);
  });
});

describe("23-26 call trees", () => {
  it("23. grouping rule is documented and exported", () => {
    expect(CALL_SESSION_GROUPING_RULE).toContain("parentCallSid");
    expect(CALL_SESSION_GROUPING_RULE).toContain("analytics projection");
    expect(GROUPING_FROM_MODULE).toBe(CALL_SESSION_GROUPING_RULE);
  });

  it("24. parent+child CallSids collapse to one callSessionKey", () => {
    const groups = groupCallSessions({
      receipts: [
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_parent" }),
        receipt({
          eventType: "CALL_CONNECTED",
          callSid: "CA_child",
          parentCallSid: "CA_parent",
          durationSeconds: 30,
        }),
      ],
      sessions: [],
      contextLinks: [],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.callSids.sort()).toEqual(["CA_child", "CA_parent"].sort());
  });

  it("25. two SIDs sharing a Claire conversation collapse; independent SIDs do not", () => {
    const collapsed = project({
      receipts: [
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_leg1" }),
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_leg2" }),
      ],
      contextLinks: [
        {
          tenantId: TENANT,
          providerResourceSid: "CA_leg1",
          resourceKind: "call",
          partyClass: null,
          goldlineEntityKind: "conversation",
          goldlineEntityId: "conv-shared",
          source: "claire_session_link",
          proof: "claire_conversation_sessions.claireConversationId",
        },
        {
          tenantId: TENANT,
          providerResourceSid: "CA_leg2",
          resourceKind: "call",
          partyClass: null,
          goldlineEntityKind: "conversation",
          goldlineEntityId: "conv-shared",
          source: "claire_session_link",
          proof: "claire_conversation_sessions.claireConversationId",
        },
      ],
    });
    expect(collapsed.communications.all.voice.uniqueSessionsAttempted).toBe(1);
    expect(collapsed.dataQuality.callLegsCollapsedCount).toBe(1);

    const independent = project({
      receipts: [
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_x" }),
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_y" }),
      ],
    });
    expect(independent.communications.all.voice.uniqueSessionsAttempted).toBe(2);
    expect(independent.dataQuality.callLegsCollapsedCount).toBe(0);
  });

  it("26. raw receipts are not rewritten by grouping", () => {
    const receipts = [
      receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_keep", parentCallSid: "CA_root" }),
    ];
    groupCallSessions({ receipts, sessions: [], contextLinks: [] });
    expect(receipts[0]?.callSid).toBe("CA_keep");
    expect(receipts[0]?.parentCallSid).toBe("CA_root");
  });
});

describe("27-31 session linkage", () => {
  it("27. CallSid matching claire_conversation_sessions.providerCallSid is session-linked", () => {
    const summary = project({
      receipts: [receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_sess" })],
      claireSessions: [
        {
          tenantId: TENANT,
          providerCallSid: "CA_sess",
          claireConversationId: "conv-sess",
          missionId: 44,
          relatedActionIds: ["action-1"],
          operatorUserId: "adam-admin",
          startedAt: "2026-09-20T18:00:00.000Z",
        },
      ],
    });
    expect(summary.linkage.sessionLinkedCount).toBe(1);
    expect(summary.linkage.missionLinkedCount).toBe(1);
    expect(summary.linkage.actionLinkedCount).toBe(1);
  });

  it("28. session linked is not automatically mission linked", () => {
    const summary = project({
      receipts: [receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_nomission" })],
      claireSessions: [
        {
          tenantId: TENANT,
          providerCallSid: "CA_nomission",
          claireConversationId: "conv-nomission",
          missionId: null,
          relatedActionIds: [],
          operatorUserId: "adam-admin",
          startedAt: "2026-09-20T18:00:00.000Z",
        },
      ],
    });
    expect(summary.linkage.sessionLinkedCount).toBe(1);
    expect(summary.linkage.missionLinkedCount).toBe(0);
    expect(summary.linkage.sessionLinkedButMissionUnlinkedCount).toBe(1);
  });

  it("29. matching CallSid with missionId null: sessionLinked true, missionLinked false", () => {
    const summary = project({
      receipts: [receipt({ eventType: "CALL_COMPLETED", callSid: "CA_null_mission", durationSeconds: 5 })],
      claireSessions: [
        {
          tenantId: TENANT,
          providerCallSid: "CA_null_mission",
          claireConversationId: "conv-null",
          missionId: null,
          relatedActionIds: ["kept"],
          operatorUserId: "adam-admin",
          startedAt: "2026-09-20T18:00:00.000Z",
        },
      ],
    });
    expect(summary.linkage.sessionLinkedCount).toBe(1);
    expect(summary.linkage.missionLinkedCount).toBe(0);
    expect(summary.linkage.actionLinkedCount).toBe(1);
  });

  it("30. empty relatedActionIdsJson is actionLinked false unless another authoritative action exists", () => {
    const emptyActions = project({
      receipts: [receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_empty_actions" })],
      claireSessions: [
        {
          tenantId: TENANT,
          providerCallSid: "CA_empty_actions",
          claireConversationId: "conv-empty",
          missionId: 3,
          relatedActionIds: [],
          operatorUserId: "adam-admin",
          startedAt: "2026-09-20T18:00:00.000Z",
        },
      ],
    });
    expect(emptyActions.linkage.actionLinkedCount).toBe(0);
    expect(emptyActions.linkage.missionLinkedCount).toBe(1);

    const viaLink = project({
      receipts: [receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_action_link" })],
      claireSessions: [
        {
          tenantId: TENANT,
          providerCallSid: "CA_action_link",
          claireConversationId: "conv-action",
          missionId: null,
          relatedActionIds: [],
          operatorUserId: "adam-admin",
          startedAt: "2026-09-20T18:00:00.000Z",
        },
      ],
      contextLinks: [
        {
          tenantId: TENANT,
          providerResourceSid: "CA_action_link",
          resourceKind: "call",
          partyClass: null,
          goldlineEntityKind: "action",
          goldlineEntityId: "action-explicit",
          source: "explicit_action_link",
          proof: "related action id persisted on an authoritative Goldline record",
        },
      ],
    });
    expect(viaLink.linkage.actionLinkedCount).toBe(1);
  });

  it("31. no phone matching as attribution", () => {
    const summary = project({
      receipts: [
        receipt({
          eventType: "CALL_ATTEMPTED",
          callSid: "CA_phone_attr",
          from: "+13105550100",
          to: "+13105550999",
        }),
      ],
      acquisitions: [
        {
          tenantId: TENANT,
          orderId: 99,
          missionId: 1,
          campaignLinkId: "camp-1",
          firstTouchSourceId: "src-1",
          reviewState: "attributed",
          conversionAt: "2026-09-21T00:00:00.000Z",
          createdAt: "2026-09-21T00:00:00.000Z",
        },
      ],
    });
    expect(summary.linkage.orderLinkedCount).toBe(0);
    expect(summary.linkage.goldlineLinkedCount).toBe(0);
  });
});

describe("32-35 no heuristic", () => {
  it("32. nearby timestamps do not create a Goldline link", () => {
    const summary = project({
      receipts: [
        receipt({
          eventType: "CALL_COMPLETED",
          callSid: "CA_near",
          createdAt: "2026-09-20T18:00:00.000Z",
          durationSeconds: 12,
        }),
      ],
      claireSessions: [
        {
          tenantId: TENANT,
          providerCallSid: "CA_other",
          claireConversationId: "conv-other",
          missionId: 8,
          relatedActionIds: [],
          operatorUserId: "adam-admin",
          startedAt: "2026-09-20T18:00:01.000Z",
        },
      ],
    });
    expect(summary.linkage.sessionLinkedCount).toBe(0);
    expect(summary.linkage.unlinkedCount).toBe(1);
  });

  it("33. likely/probable/AI_matched/inferred_customer sources are rejected", () => {
    expect(() =>
      buildCommunicationContextLink({
        tenantId: TENANT,
        providerResourceSid: "CA_bad",
        resourceKind: "call",
        source: "AI_matched" as never,
        proof: "no",
      })
    ).toThrow(CommunicationContextLinkError);
  });

  it("34. provider SID cannot be stored as a Goldline entity id", () => {
    expect(providerSidIsGoldlineEntityId("CA_not_an_entity")).toBe(false);
    expect(() =>
      buildCommunicationContextLink({
        tenantId: TENANT,
        providerResourceSid: "CA_same",
        resourceKind: "call",
        goldlineEntityKind: "conversation",
        goldlineEntityId: "CA_same",
        source: "claire_session_link",
        proof: "illegal",
      })
    ).toThrow(/provider SID was treated as a Goldline entity id/);
  });

  it("35. sparse linkage is intended: unlinked communications remain unlinked with no historical backfill", () => {
    const summary = project({
      receipts: [receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_sparse" })],
    });
    expect(summary.linkage.unlinkedCount).toBe(1);
    expect(summary.linkage.goldlineLinkedCount).toBe(0);
  });
});

describe("36-37 chronology", () => {
  it("36. business events before the communication are linked context, not downstream", () => {
    const summary = project({
      receipts: [
        receipt({
          eventType: "CALL_ATTEMPTED",
          callSid: "CA_after_order",
          createdAt: "2026-09-20T18:00:00.000Z",
        }),
      ],
      claireSessions: [
        {
          tenantId: TENANT,
          providerCallSid: "CA_after_order",
          claireConversationId: "conv-after",
          missionId: 70,
          relatedActionIds: [],
          operatorUserId: "adam-admin",
          startedAt: "2026-09-20T18:00:00.000Z",
        },
      ],
      acquisitions: [
        {
          tenantId: TENANT,
          orderId: 501,
          missionId: 70,
          campaignLinkId: "camp-70",
          firstTouchSourceId: "src-70",
          reviewState: "attributed",
          conversionAt: "2026-09-01T00:00:00.000Z",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      orderAttributions: [
        {
          tenantId: TENANT,
          orderId: 501,
          missionId: 70,
          status: "active",
          netPaidCents: 4400,
        },
      ],
      paymentProjections: [
        { tenantId: TENANT, orderId: 501, state: "paid", netPaidCents: 4400 },
      ],
    });
    expect(summary.linkage.orderLinkedCount).toBe(1);
    expect(summary.downstreamAssociation.downstreamOutcomeAssociatedCount).toBe(0);
    expect(summary.downstreamAssociation.associatedPaidOrderCount).toBe(0);
    expect(summary.downstreamAssociation.associatedNetPaidCents).toBe(0);
  });

  it("37. temporal proximity never creates a downstream link", () => {
    const summary = project({
      receipts: [
        receipt({
          eventType: "CALL_COMPLETED",
          callSid: "CA_prox",
          createdAt: "2026-09-20T18:00:00.000Z",
          durationSeconds: 9,
        }),
      ],
      acquisitions: [
        {
          tenantId: TENANT,
          orderId: 777,
          missionId: 2,
          campaignLinkId: null,
          firstTouchSourceId: null,
          reviewState: "attributed",
          conversionAt: "2026-09-20T18:00:30.000Z",
          createdAt: "2026-09-20T18:00:30.000Z",
        },
      ],
      paymentProjections: [
        { tenantId: TENANT, orderId: 777, state: "paid", netPaidCents: 1200 },
      ],
    });
    expect(summary.downstreamAssociation.downstreamOutcomeAssociatedCount).toBe(0);
    expect(summary.linkage.orderLinkedCount).toBe(0);
  });
});

describe("38-47 commercial/financial", () => {
  function missionLinkedOrder(input: {
    orderId: number;
    missionId: number;
    conversionAt: string;
    netPaidCents: number | null;
    status?: "active" | "reversed" | "financial_review";
    paymentState?: "unpaid" | "paid" | "partially_refunded" | "refunded" | "cancelled" | "review_required";
    paymentNet?: number | null;
    orderTotalCents?: number | null;
    callSid?: string;
  }) {
    const callSid = input.callSid ?? `CA_ord_${input.orderId}`;
    return {
      receipts: [
        receipt({
          eventType: "CALL_ATTEMPTED",
          callSid,
          createdAt: "2026-09-18T18:00:00.000Z",
        }),
      ],
      claireSessions: [
        {
          tenantId: TENANT,
          providerCallSid: callSid,
          claireConversationId: `conv-${input.orderId}`,
          missionId: input.missionId,
          relatedActionIds: [],
          operatorUserId: "adam-admin",
          startedAt: "2026-09-18T18:00:00.000Z",
        },
      ],
      acquisitions: [
        {
          tenantId: TENANT,
          orderId: input.orderId,
          missionId: input.missionId,
          campaignLinkId: "camp-x",
          firstTouchSourceId: "src-x",
          reviewState: "attributed",
          conversionAt: input.conversionAt,
          createdAt: input.conversionAt,
        },
      ],
      orderAttributions: [
        {
          tenantId: TENANT,
          orderId: input.orderId,
          missionId: input.missionId,
          status: input.status ?? "active",
          netPaidCents: input.netPaidCents,
        },
      ],
      paymentProjections: [
        {
          tenantId: TENANT,
          orderId: input.orderId,
          state: input.paymentState ?? "paid",
          netPaidCents: input.paymentNet ?? input.netPaidCents,
        },
      ],
      orders: [
        {
          tenantId: TENANT,
          orderId: input.orderId,
          status: "delivered",
          paid: true,
          totalCents: input.orderTotalCents ?? 99999,
          createdAt: input.conversionAt,
          paidAt: input.conversionAt,
        },
      ],
    } satisfies Partial<CommunicationsProjectionFacts>;
  }

  it("38. reads commercial attribution and payment projections without writing them", () => {
    const source = readFileSync(
      "server/communicationsAnalytics/projectSummary.ts",
      "utf8"
    );
    expect(source).not.toMatch(/attributeOrderFromCampaign|reverseCommercialOrderAttribution/);
    const summary = project(
      missionLinkedOrder({
        orderId: 10,
        missionId: 3,
        conversionAt: "2026-09-21T00:00:00.000Z",
        netPaidCents: 2500,
      })
    );
    expect(summary.downstreamAssociation.associatedPaidOrderCount).toBe(1);
    expect(summary.downstreamAssociation.associatedNetPaidCents).toBe(2500);
  });

  it("39. communications-linked context does not invent Claire revenue attribution", () => {
    const summary = project(
      missionLinkedOrder({
        orderId: 11,
        missionId: 3,
        conversionAt: "2026-09-21T00:00:00.000Z",
        netPaidCents: 2500,
      })
    );
    expect(summary.provenance.causalClaim).toBe(false);
    expect(JSON.stringify(summary)).not.toMatch(/Claire revenue|attributed revenue/i);
  });

  it("40. commercial/payment truth wins when orders.total disagrees", () => {
    const summary = project(
      missionLinkedOrder({
        orderId: 12,
        missionId: 3,
        conversionAt: "2026-09-21T00:00:00.000Z",
        netPaidCents: 1800,
        orderTotalCents: 9900,
      })
    );
    expect(summary.downstreamAssociation.associatedNetPaidCents).toBe(1800);
    expect(summary.dataQuality.financialConflictCount).toBe(1);
  });

  it("41. data-quality conflict is exposed when attribution net disagrees with payment net", () => {
    const summary = project(
      missionLinkedOrder({
        orderId: 13,
        missionId: 3,
        conversionAt: "2026-09-21T00:00:00.000Z",
        netPaidCents: 1800,
        paymentNet: 1700,
        paymentState: "paid",
      })
    );
    expect(summary.downstreamAssociation.associatedNetPaidCents).toBe(1700);
    expect(summary.dataQuality.financialConflictCount).toBe(1);
  });

  it("42. canonical netPaidCents is used, not orders.total", () => {
    const summary = project(
      missionLinkedOrder({
        orderId: 14,
        missionId: 3,
        conversionAt: "2026-09-21T00:00:00.000Z",
        netPaidCents: 333,
        orderTotalCents: 8888,
      })
    );
    expect(summary.downstreamAssociation.associatedNetPaidCents).toBe(333);
  });

  it("43. full refund/reversed is 0 associated net paid", () => {
    const summary = project(
      missionLinkedOrder({
        orderId: 15,
        missionId: 3,
        conversionAt: "2026-09-21T00:00:00.000Z",
        netPaidCents: 0,
        status: "reversed",
        paymentState: "refunded",
        paymentNet: 0,
        orderTotalCents: 5000,
      })
    );
    expect(summary.downstreamAssociation.associatedNetPaidCents).toBe(0);
    expect(summary.downstreamAssociation.associatedPaidOrderCount).toBe(1);
  });

  it("44. partial refund uses canonical net", () => {
    const summary = project(
      missionLinkedOrder({
        orderId: 16,
        missionId: 3,
        conversionAt: "2026-09-21T00:00:00.000Z",
        netPaidCents: 600,
        paymentState: "partially_refunded",
        paymentNet: 600,
        orderTotalCents: 1000,
      })
    );
    expect(summary.downstreamAssociation.associatedNetPaidCents).toBe(600);
  });

  it("45. financial_review is excluded from clean associated net paid revenue", () => {
    const summary = project(
      missionLinkedOrder({
        orderId: 17,
        missionId: 3,
        conversionAt: "2026-09-21T00:00:00.000Z",
        netPaidCents: null,
        status: "financial_review",
        paymentState: "review_required",
        paymentNet: null,
      })
    );
    expect(summary.downstreamAssociation.associatedNetPaidCents).toBe(0);
    expect(summary.downstreamAssociation.associatedPaidOrderCount).toBe(0);
    expect(summary.dataQuality.financialReviewOrdersExcludedCount).toBe(1);
  });

  it("46. unknown net is not zero", () => {
    const summary = project(
      missionLinkedOrder({
        orderId: 18,
        missionId: 3,
        conversionAt: "2026-09-21T00:00:00.000Z",
        netPaidCents: null,
        paymentNet: null,
        paymentState: "paid",
      })
    );
    expect(summary.downstreamAssociation.associatedNetPaidCents).toBeNull();
    expect(summary.downstreamAssociation.associatedNetPaidUnknownOrderCount).toBe(1);
    expect(summary.downstreamAssociation.associatedPaidOrderCount).toBe(0);
  });

  it("47. one order linked through three communications contributes revenue once", () => {
    const base = missionLinkedOrder({
      orderId: 19,
      missionId: 88,
      conversionAt: "2026-09-21T00:00:00.000Z",
      netPaidCents: 5000,
    });
    const summary = project({
      receipts: [
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_1", createdAt: "2026-09-18T18:00:00.000Z" }),
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_2", createdAt: "2026-09-19T18:00:00.000Z" }),
        receipt({ eventType: "MESSAGE_SENT", messageSid: "SM_3", createdAt: "2026-09-19T19:00:00.000Z" }),
      ],
      claireSessions: [
        {
          tenantId: TENANT,
          providerCallSid: "CA_1",
          claireConversationId: "conv-1",
          missionId: 88,
          relatedActionIds: [],
          operatorUserId: "adam-admin",
          startedAt: "2026-09-18T18:00:00.000Z",
        },
        {
          tenantId: TENANT,
          providerCallSid: "CA_2",
          claireConversationId: "conv-2",
          missionId: 88,
          relatedActionIds: [],
          operatorUserId: "adam-admin",
          startedAt: "2026-09-19T18:00:00.000Z",
        },
      ],
      contextLinks: [
        {
          tenantId: TENANT,
          providerResourceSid: "SM_3",
          resourceKind: "message",
          partyClass: "system_to_operator",
          goldlineEntityKind: "mission",
          goldlineEntityId: "88",
          source: "explicit_mission_link",
          proof: "operator artifact send during mission 88",
        },
      ],
      acquisitions: base.acquisitions,
      orderAttributions: base.orderAttributions,
      paymentProjections: base.paymentProjections,
      orders: base.orders,
    });
    expect(summary.downstreamAssociation.associatedPaidOrderCount).toBe(1);
    expect(summary.downstreamAssociation.associatedNetPaidCents).toBe(5000);
    expect(summary.downstreamAssociation.paidRevenueAssociatedCount).toBe(3);
  });
});

describe("48-51 business truth", () => {
  it("48. does not weaken BUSINESS_OUTCOMES_NOT_IMPLIED_BY_COMMUNICATIONS", () => {
    expect([...BUSINESS_OUTCOMES_NOT_IMPLIED_BY_COMMUNICATIONS]).toEqual([
      "CUSTOMER_INTERESTED",
      "CUSTOMER_APPROVED",
      "PROPERTY_APPROVED",
      "SALES_FOLLOWUP_SUCCESS",
      "MISSION_COMPLETED",
      "SALE_WON",
      "PROMISE_KEPT",
      "WEEKLY_INTENT_FULFILLED",
      "DAILY_COMMAND_COMPLETED",
      "NARRATOR_EVENT",
    ]);
  });

  it("49. communications evidence still cannot imply a business outcome", () => {
    const evidence = toCommunicationCandidateEvidence(
      receipt({
        eventType: "CALL_CONNECTED",
        callSid: "CA_biz",
        durationSeconds: 400,
      })
    );
    expect(communicationEvidenceImpliesBusinessOutcome(evidence[0]!)).toBe(false);
  });

  it("50. context link idempotency is stable across retries", () => {
    const key = communicationContextLinkIdempotencyKey({
      tenantId: TENANT,
      providerResourceSid: "SM_retry",
      source: "direct_provider_link",
      goldlineEntityKind: "operator",
      goldlineEntityId: "adam-admin",
      partyClass: "system_to_operator",
    });
    const again = communicationContextLinkIdempotencyKey({
      tenantId: TENANT,
      providerResourceSid: "SM_retry",
      source: "direct_provider_link",
      goldlineEntityKind: "operator",
      goldlineEntityId: "adam-admin",
      partyClass: "system_to_operator",
    });
    expect(key).toBe(again);
  });

  it("51. analytics does not emit a dayforge_product_event per Twilio callback", () => {
    const files = [
      "server/communicationsAnalytics/projectSummary.ts",
      "server/communicationsAnalytics/queries.ts",
      "server/communicationsAnalytics/communicationsEffectiveness.ts",
      "server/communicationsAnalytics/contextLinks.ts",
    ];
    for (const file of files) {
      expect(readFileSync(file, "utf8")).not.toMatch(/writeDayforgeEvent|dayforge_product_event/);
    }
  });
});

describe("52-53 privacy", () => {
  it("52. projection contains no full phone numbers", () => {
    const summary = project({
      receipts: fourEventCall("CA_pii", {
        from: "+13105550100",
        to: "+13105550101",
      }),
    });
    const blob = JSON.stringify(summary);
    expect(blob).not.toContain("+13105550100");
    expect(blob).not.toContain("+13105550101");
    expect(blob).not.toContain("3105550100");
  });

  it("53. projection contains no transcripts, SMS bodies, recordings, or tokens", () => {
    const summary = project({ receipts: fourEventCall("CA_priv") });
    const blob = JSON.stringify(summary);
    expect(blob.toLowerCase()).not.toContain("transcript");
    expect(blob.toLowerCase()).not.toContain("recordingsid");
    expect(blob.toLowerCase()).not.toContain("auth_token");
    expect(blob).not.toMatch(/Gate code is/);
  });
});

describe("54-56 evidence summary", () => {
  it("54. investor summary includes the required typed sections", () => {
    const summary = project();
    expect(summary.observationWindow.windowDays).toBe(30);
    expect(summary.communications.all).toBeTruthy();
    expect(summary.partyClassification).toBeTruthy();
    expect(summary.linkage).toBeTruthy();
    expect(summary.downstreamAssociation).toBeTruthy();
    expect(summary.dataQuality).toBeTruthy();
    expect(summary.provenance.communicationSource).toBe("communication_receipts");
    expect(summary.provenance.businessSources).toEqual([...COMMUNICATIONS_BUSINESS_SOURCES]);
  });

  it("55. provenance.causalClaim is a real runtime field equal to false", () => {
    const evidenceSummary = project();
    expect(evidenceSummary.provenance.causalClaim).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(evidenceSummary.provenance, "causalClaim")).toBe(
      true
    );
  });

  it("56. evidenceSummary.provenance.causalClaim === false", () => {
    const evidenceSummary = project({ receipts: fourEventCall("CA_claim") });
    expect(evidenceSummary.provenance.causalClaim === false).toBe(true);
  });
});

describe("57-66 UI", () => {
  const ui = readFileSync("client/src/pages/GoldlineEffectivenessAdmin.tsx", "utf8");

  it("57. COMMUNICATIONS section includes ALL OBSERVED, PARTY CLASS, GOLDLINE LINKAGE, DOWNSTREAM ASSOCIATION, DATA QUALITY", () => {
    expect(ui).toContain("COMMUNICATIONS");
    expect(ui).toContain("ALL OBSERVED");
    expect(ui).toContain("PARTY CLASS");
    expect(ui).toContain("GOLDLINE LINKAGE");
    expect(ui).toContain("DOWNSTREAM ASSOCIATION");
    expect(ui).toContain("DATA QUALITY");
  });

  it("58. always-visible disclaimer is the required sentence", () => {
    expect(ui).toContain("COMMUNICATIONS_UI_DISCLAIMER");
    expect(COMMUNICATIONS_UI_DISCLAIMER).toBe(
      "Communication receipts prove provider activity. Downstream figures are shown only when Goldline has an explicit authoritative link. These are observed associations, not proof that a call or message caused the business outcome."
    );
  });

  it("59. window selector is 7D/30D/90D", () => {
    expect(ui).toContain("7D");
    expect(ui).toContain("30D");
    expect(ui).toContain("90D");
  });

  it("60. banned labels are absent from the communications UI", () => {
    for (const label of COMMUNICATIONS_BANNED_UI_LABELS) {
      expect(ui).not.toContain(label);
    }
  });

  it("61. required labels are present", () => {
    for (const label of [
      "Observed",
      "Connected",
      "Delivered",
      "Internal",
      "External",
      "Unknown",
      "Goldline-linked",
      "Session-linked",
      "Mission-linked",
      "Action-linked",
      "Associated",
      "Associated paid orders",
      "Associated net paid revenue",
      "Unlinked",
    ]) {
      expect(ui).toContain(label);
    }
  });

  it("62. light-mode page class is used and dark mode is not introduced", () => {
    expect(ui).toContain("sales-intel-admin");
    expect(ui).not.toMatch(/dark:|prefers-color-scheme:\s*dark/);
    const css = readFileSync("client/src/pages/sales-intel-admin.css", "utf8");
    expect(css).not.toMatch(/prefers-color-scheme:\s*dark/);
    expect(css).toContain("#f7f6f1");
  });

  it("63. extends GoldlineEffectivenessAdmin rather than replacing play/business sections", () => {
    expect(ui).toContain("PLAY");
    expect(ui).toContain("TRUSTED BUSINESS OUTCOME");
    expect(ui).toContain("COMMUNICATIONS");
  });

  it("64. does not add a vanity dashboard route", () => {
    expect(ui).not.toContain("Investor dashboard");
    expect(ui).not.toContain("Claire ROI");
  });

  it("65. Not tracked is used for null rates instead of fabricated 0%", () => {
    expect(ui).toContain("Not tracked");
    expect(ui).toContain("formatRate");
  });

  it("66. existing effectiveness page is still the host, not a redesigned shell", () => {
    expect(ui).toContain("Play and business behavior");
    expect(ui).toContain("communications-analytics");
  });
});

describe("67-69 no real provider traffic", () => {
  it("67. analytics modules do not create Twilio calls or messages", () => {
    const files = [
      "server/communicationsAnalytics/projectSummary.ts",
      "server/communicationsAnalytics/queries.ts",
      "server/communicationsAnalytics/communicationsEffectiveness.ts",
      "server/communicationsAnalytics/observationWindow.ts",
      "server/communicationsAnalytics/callSessionGrouping.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/calls\.create|messages\.create|twilio\(/);
    }
  });

  it("68. tests use fixtures and never require live Twilio credentials", () => {
    expect(process.env.TWILIO_AUTH_TOKEN ?? "").not.toContain("live");
    const summary = project({ receipts: fourEventCall("CA_fixture") });
    expect(summary.communications.all.voice.uniqueSessionsAttempted).toBe(1);
  });

  it("69. this slice does not change Railway variables, Conversation Relay, Gather, AMD, or webhooks", () => {
    const files = [
      "server/communicationsAnalytics/projectSummary.ts",
      "server/communicationsAnalytics/communicationsEffectiveness.ts",
      "server/dayforgeEvents/goldlineEventRouter.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/CLAIRE_TWILIO_CONVERSATION_RELAY|TWILIO_AUTH_TOKEN|CLAIRE_AMD/);
    }
  });
});

describe("tenant isolation and messaging dedupe", () => {
  it("counts messages once across SENT+DELIVERED and ignores other tenants", () => {
    const summary = project({
      receipts: [
        receipt({ eventType: "MESSAGE_SENT", messageSid: "SM_one" }),
        receipt({ eventType: "MESSAGE_DELIVERED", messageSid: "SM_one" }),
        receipt({
          tenantId: OTHER,
          eventType: "MESSAGE_SENT",
          messageSid: "SM_other",
        }),
      ],
    });
    expect(summary.communications.all.messaging.uniqueMessagesSent).toBe(1);
    expect(summary.communications.all.messaging.uniqueMessagesDelivered).toBe(1);
    expect(summary.communications.all.messaging.deliveryRate).toBe(1);
  });

  it("counts missing terminal and missing duration in data quality, not as 0 duration", () => {
    const summary = project({
      receipts: [
        receipt({ eventType: "CALL_ATTEMPTED", callSid: "CA_open" }),
        receipt({ eventType: "CALL_CONNECTED", callSid: "CA_nodur" }),
        receipt({ eventType: "MESSAGE_SENT", messageSid: "SM_wait" }),
      ],
    });
    expect(summary.dataQuality.callsMissingTerminalStateCount).toBe(2);
    expect(summary.dataQuality.callsMissingDurationCount).toBe(1);
    expect(summary.dataQuality.messagesAwaitingTerminalStateCount).toBe(1);
    expect(summary.communications.all.voice.observedConnectedDurationSeconds).toBeNull();
  });
});
