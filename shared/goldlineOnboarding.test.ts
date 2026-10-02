import { describe, expect, it } from "vitest";
import { answerSession, businessProfileSchema, orderedGoldlineOnboardingAnswers, type GoldlineOnboardingSession } from "./goldlineOnboarding";
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
