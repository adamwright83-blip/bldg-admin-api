import { describe, expect, it } from "vitest";
import { answerSession, attachFirstAction, authorOperatorTask, businessProfileSchema, onboardingPreviewForConnection, onboardingReadTenantId, orderedGoldlineOnboardingAnswers, prepareClaireOpening, sessionForReader, tenantRecordVisible, type GoldlineOnboardingSession } from "./goldlineOnboarding";
const session: GoldlineOnboardingSession = { id: "s", tenantId: "a", status: "INTERVIEW", currentQuestion: 0, answers: [], interpretation: null, optionalUploadReference: null, startedAt: "2026-09-04", completedAt: null, version: 0, world: null, mission: null };
describe("onboarding truth and resume", () => {
 it("resumes Q4 after three answers and creates no world or evidence", () => { let s=session; for(let i=0;i<3;i++) s=answerSession(s,i,`specific answer ${i}`); expect(s.currentQuestion).toBe(3); expect(s.answers).toHaveLength(3); expect(s.world).toBeNull(); expect(s.interpretation).toBeNull(); expect(s.tenantId).toBe("a"); expect(session.answers).toEqual([]); });
 it("rejects stale, blank and out-of-order answers",()=> { expect(()=>answerSession(session,2,"x")).toThrow(); expect(()=>answerSession(session,0," ")).toThrow(); });
 it("closes interview after exactly five answers",()=>{ let s=session; for(let i=0;i<5;i++) s=answerSession(s,i,"x"); expect(s.status).toBe("READY"); expect(()=>answerSession(s,4,"x")).toThrow(); });
 it("resumes only the two unanswered canonical questions after the pre-pay draft",()=> {
  let s: GoldlineOnboardingSession = {
    ...session,
    currentQuestion: 2,
    answersByKey: {
      daily_work: "service calls",
      service_area: "Pasadena",
      avoidance: "follow-up",
    },
    answerProvenanceByKey: {
      daily_work: "operator_declared",
      service_area: "operator_declared",
      avoidance: "operator_declared",
    },
  };
  s=answerSession(s,2,"referrals");
  expect(s.currentQuestion).toBe(4);
  expect(s.answersByKey?.avoidance).toBe("follow-up");
  s=answerSession(s,4,"two more recurring customers");
  expect(s.status).toBe("READY");
  expect(orderedGoldlineOnboardingAnswers(s)).toEqual([
    "service calls",
    "Pasadena",
    "referrals",
    "follow-up",
    "two more recurring customers",
  ]);
 });
 it("rejects model invented customer fields",()=>expect(businessProfileSchema.safeParse({ customers: [{name:"invented"}] }).success).toBe(false));
});

describe("unconnected preview and tenant read", () => {
  it("labels a preview without a connection as illustrative and does not keep invented names", () => {
    const preview = onboardingPreviewForConnection({
      connection: "none",
      connectedNames: ["Jane Doe", "Acme Laundry"],
    });
    expect(preview.label).toBe("Illustrative");
    expect(preview.illustrative).toBe(true);
    expect(preview.factualNames).toEqual([]);
    expect(preview.factualSales).toEqual([]);
    expect(preview.note).toContain("Illustrative preview");
    expect(preview.note).toContain("Not your customers or sales");
    expect(JSON.stringify(preview)).not.toMatch(/Jane Doe|Acme Laundry|\$\d/);
  });

  it("does not let a second tenant id read as the default tenant", () => {
    expect(onboardingReadTenantId("second-tenant")).toBe("second-tenant");
    expect(onboardingReadTenantId("second-tenant")).not.toBe("default");
    expect(tenantRecordVisible("default", "second-tenant")).toBe(false);
    expect(tenantRecordVisible("second-tenant", "default")).toBe(false);
    expect(tenantRecordVisible("second-tenant", "second-tenant")).toBe(true);
    expect(sessionForReader({ tenantId: "default" }, "second-tenant")).toBeNull();
    expect(sessionForReader({ tenantId: "second-tenant" }, "second-tenant")?.tenantId).toBe("second-tenant");
    expect(() => onboardingReadTenantId("")).toThrow(/default tenant/);
    expect(() => onboardingReadTenantId(null)).toThrow(/default tenant/);
  });

  it("stores a desk first action as operator-reported and not a verified outcome", () => {
    const opened: GoldlineOnboardingSession = {
      ...session,
      answersByKey: {
        daily_work: "I run plumbing service calls",
        service_area: "Pasadena",
        avoidance: "following up on estimates",
      },
    };
    expect(() => prepareClaireOpening(session)).toThrow(/three opening questions/);
    const prepared = prepareClaireOpening(opened, new Date("2026-10-15T00:00:00.000Z"));
    expect(prepared).toMatchObject({
      kind: "claire_preparation",
      provenance: "operator_reported",
      verifiedBusinessOutcome: false,
      requiresIntegration: false,
      requiresPhone: false,
    });
    expect(prepared.text).toContain("I run plumbing service calls");
    expect(prepared.text).toContain("Pasadena");
    expect(prepared.text).toContain("following up on estimates");
    expect(prepared.text).toMatch(/not a customer, a sale, or a verified result/i);
    expect(prepared.text).not.toMatch(/Jane Doe|Acme/);
    const tasked = attachFirstAction(
      opened,
      authorOperatorTask("Send the estimate I already wrote", new Date("2026-10-15T00:00:00.000Z"))
    );
    expect(tasked.firstAction).toMatchObject({
      kind: "operator_authored_task",
      text: "Send the estimate I already wrote",
      provenance: "operator_reported",
      verifiedBusinessOutcome: false,
      requiresPhone: false,
      requiresIntegration: false,
    });
    expect(tasked.world).toBeNull();
    expect(tasked.interpretation).toBeNull();
    expect(tasked.status).toBe("INTERVIEW");
    expect(attachFirstAction(tasked, prepared)).toBe(tasked);
  });
});
