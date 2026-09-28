import { describe, expect, it } from "vitest";
import {
  EMPTY_FIELD_JOURNAL_EXTRACTION,
  type FieldJournalExtraction,
} from "./fieldJournal";
import { deriveMissionLinkedDebriefProposal } from "./missionLinkedDebrief";

function evidence(value: string) {
  return {
    value,
    provenance: "operator_reported" as const,
    confidence: "high" as const,
    transcriptExcerpt: value,
  };
}

function extraction(
  patch: Partial<FieldJournalExtraction>
): FieldJournalExtraction {
  return {
    ...EMPTY_FIELD_JOURNAL_EXTRACTION,
    ...patch,
  };
}

describe("mission-linked debrief proposal", () => {
  it("keeps a blocked front-desk visit truthfully at no_contact", () => {
    const proposal = deriveMissionLinkedDebriefProposal({
      buildingName: "Los Feliz Towers",
      transcript: "The manager was unavailable. I left a card.",
      extraction: extraction({
        outcomes: [
          {
            entityClientKey: null,
            type: "manager_unavailable",
            evidence: evidence("The manager was unavailable."),
            explicitlyReported: true,
          },
        ],
        actions: [
          {
            entityClientKey: null,
            type: "collateral_delivered",
            evidence: evidence("I left a card."),
            occurredAtText: null,
          },
        ],
      }),
    });

    expect(proposal.outcome).toBe("no_contact");
    expect(proposal.decisionMakerStatus).toBe("unavailable");
    expect(proposal.collateralDelivered).toBe(true);
    expect(proposal.question).toBeNull();
    expect(proposal.summary).toMatch(/still unresolved/i);
  });

  it("keeps an interested but undecided meeting at no_decision", () => {
    const proposal = deriveMissionLinkedDebriefProposal({
      buildingName: "Los Feliz Towers",
      transcript: "She was interested but made no decision.",
      extraction: extraction({
        outcomes: [
          {
            entityClientKey: null,
            type: "interested_reported",
            evidence: evidence("She was interested"),
            explicitlyReported: true,
          },
        ],
      }),
    });

    expect(proposal.outcome).toBe("no_decision");
    expect(proposal.followUpRequested).toBe(false);
    expect(proposal.summary).toMatch(/no decision/i);
  });

  it("turns an explicit return request into follow_up and asks exactly one contextual timing question", () => {
    const proposal = deriveMissionLinkedDebriefProposal({
      buildingName: "Los Feliz Towers",
      transcript: "The front desk asked me to return Thursday morning.",
      extraction: extraction({
        outcomes: [
          {
            entityClientKey: null,
            type: "asked_to_return",
            evidence: evidence("asked me to return Thursday morning"),
            explicitlyReported: true,
          },
        ],
      }),
    });

    expect(proposal.outcome).toBe("follow_up");
    expect(proposal.followUpRequested).toBe(true);
    expect(proposal.question).toEqual({
      kind: "follow_up_at",
      prompt: "When did they ask you to come back or follow up?",
      inputType: "datetime-local",
    });
    expect(Array.isArray(proposal.question)).toBe(false);
  });

  it("preserves an explicit return request even when the manager was unavailable", () => {
    const proposal = deriveMissionLinkedDebriefProposal({
      buildingName: "Los Feliz Towers",
      transcript: "The manager was unavailable, and the front desk asked me to return Tuesday.",
      extraction: extraction({
        outcomes: [
          {
            entityClientKey: null,
            type: "manager_unavailable",
            evidence: evidence("The manager was unavailable"),
            explicitlyReported: true,
          },
          {
            entityClientKey: null,
            type: "asked_to_return",
            evidence: evidence("asked me to return Tuesday"),
            explicitlyReported: true,
          },
        ],
      }),
    });

    expect(proposal.outcome).toBe("follow_up");
    expect(proposal.decisionMakerStatus).toBe("unavailable");
    expect(proposal.followUpRequested).toBe(true);
    expect(proposal.question?.kind).toBe("follow_up_at");
  });

  it("collects return timing and a missing collateral email one question at a time", () => {
    const proposal = deriveMissionLinkedDebriefProposal({
      buildingName: "Los Feliz Towers",
      transcript: "The front desk asked me to return Tuesday and email the packet.",
      extraction: extraction({
        outcomes: [
          {
            entityClientKey: null,
            type: "asked_to_return",
            evidence: evidence("asked me to return Tuesday"),
            explicitlyReported: true,
          },
        ],
        followUps: [
          {
            entityClientKey: null,
            requestedAction: evidence("email the packet"),
            explicitDateText: "Tuesday",
          },
        ],
      }),
    });

    expect(proposal.outcome).toBe("follow_up");
    expect(proposal.question?.kind).toBe("follow_up_at");
    expect(proposal.additionalQuestion?.kind).toBe("email");
    expect(proposal.emailDraft).toMatchObject({ to: null, sendAuthorized: false });
  });

  it("recognizes explicitly reported wins and losses without upgrading an undecided visit", () => {
    const won = deriveMissionLinkedDebriefProposal({
      buildingName: "Tower A",
      transcript: "They said yes and the account was won.",
      extraction: extraction({
        outcomes: [
          {
            entityClientKey: null,
            type: "account_won_reported",
            evidence: evidence("the account was won"),
            explicitlyReported: true,
          },
        ],
      }),
    });
    const lost = deriveMissionLinkedDebriefProposal({
      buildingName: "Tower A",
      transcript: "They declined.",
      extraction: extraction({
        outcomes: [
          {
            entityClientKey: null,
            type: "declined",
            evidence: evidence("They declined."),
            explicitlyReported: true,
          },
        ],
      }),
    });

    expect(won.outcome).toBe("won");
    expect(lost.outcome).toBe("lost");
    expect(lost.reason).toBe("no_interest");
  });

  it("prepares a requested collateral email as draft-only and asks only for the missing email", () => {
    const proposal = deriveMissionLinkedDebriefProposal({
      buildingName: "Los Feliz Towers",
      transcript: "He asked me to email the packet.",
      extraction: extraction({
        followUps: [
          {
            entityClientKey: null,
            requestedAction: evidence("He asked me to email the packet."),
            explicitDateText: null,
          },
        ],
      }),
    });

    expect(proposal.outcome).toBe("no_decision");
    expect(proposal.emailDraft).toMatchObject({
      to: null,
      sendAuthorized: false,
    });
    expect(proposal.question).toEqual({
      kind: "email",
      prompt: "What email did they give you?",
      inputType: "email",
    });
  });

  it("uses a grounded known email without inventing another question and still never authorizes send", () => {
    const proposal = deriveMissionLinkedDebriefProposal({
      buildingName: "Los Feliz Towers",
      transcript: "He asked me to email the packet to gm@example.com.",
      extraction: extraction({
        entities: [
          {
            clientEntityKey: "person-1",
            kind: "person",
            propertyName: null,
            addressClue: null,
            neighborhood: null,
            websiteDomain: null,
            contactName: null,
            contactTitle: null,
            email: evidence("gm@example.com"),
            phone: null,
            amenities: [],
            architecture: [],
          },
        ],
        followUps: [
          {
            entityClientKey: "person-1",
            requestedAction: evidence("He asked me to email the packet"),
            explicitDateText: null,
          },
        ],
      }),
    });

    expect(proposal.emailDraft).toMatchObject({
      to: "gm@example.com",
      sendAuthorized: false,
    });
    expect(proposal.question).toBeNull();
  });
});
