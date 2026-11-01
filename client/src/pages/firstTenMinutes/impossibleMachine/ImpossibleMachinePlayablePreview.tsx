import { useCallback, useState } from "react";
import { ImpossibleMachine } from "./ImpossibleMachine";
import { ChapterThreshold } from "../chapter/ChapterThreshold";
import {
  generateSimulatedOpportunity,
  createSimulatedDraft,
} from "./simulatedOpportunity";
import type { ChapterOpportunity, DraftApproach, DraftView } from "@shared/firstTenMinutesChapter";
import type { ActivationView } from "@shared/firstTenMinutesActivation";
import type { StoredMachineProgress } from "./machinePersistence";
import type { MachineBusinessAdapter } from "./machineTypes";
import styles from "./impossibleMachine.module.css";
import portraitStyles from "../portrait/portrait.module.css";

const SAMPLE_REAL_OPPORTUNITY: ChapterOpportunity = {
  id: "opp_elena_ruiz_01",
  type: "unanswered",
  person: {
    name: "Elena Ruiz",
    address: "elena.ruiz@coastalmarket.example",
  },
  firstName: "Elena",
  request: {
    findingId: "f_opp_req",
    at: "2026-04-18T10:30:00Z",
    quote: "Could you do fresh arrangements every Friday for our main reception desk? Looking for a regular weekly setup starting next month.",
    wants: "Weekly fresh arrangement delivery for lobby reception desk.",
    subject: "Weekly fresh arrangement delivery for lobby?",
    sources: [
      {
        provider: "gmail",
        ref: "gmail:msg:18ef92b451000",
        at: "2026-04-18T10:30:00Z",
        who: "Elena Ruiz <elena.ruiz@coastalmarket.example>",
        label: "Email from Elena Ruiz",
        excerpt: "Could you do fresh arrangements every Friday for our main reception desk?",
        url: null,
      },
    ],
  },
  reply: {
    findingId: "f_opp_rep",
    at: "2026-04-19T14:15:00Z",
    quote: "Thanks for reaching out! Unfortunately, we only have delivery routes on Tuesdays and Thursdays right now. Ask me again once we have a Friday delivery route set up.",
    missing: "No Friday route existed at the time of inquiry.",
    sources: [
      {
        provider: "gmail",
        ref: "gmail:msg:18ef92b451001",
        at: "2026-04-19T14:15:00Z",
        who: "Nina <nina@wildroot.example>",
        label: "Email to Elena Ruiz",
        excerpt: "Unfortunately, we only have delivery routes on Tuesdays and Thursdays right now.",
        url: null,
      },
    ],
  },
  service: {
    findingId: "f_opp_svc",
    at: "2026-05-01T09:00:00Z",
    name: "Friday Delivery Route Now Available",
    quote: "Wildroot expanded delivery fleet in May — Friday morning route now covers downtown commercial lobbies.",
    sources: [],
  },
  route: null,
  place: null,
  along: null,
};

export default function ImpossibleMachinePlayablePreview() {
  const [mode, setMode] = useState<"user_b" | "user_a">("user_b");
  const [inAdventure, setInAdventure] = useState(false);

  // User B state
  const [simulatedDraft, setSimulatedDraft] = useState<DraftView | null>(null);
  const [simulatedProgress, setSimulatedProgress] = useState<Partial<StoredMachineProgress> | null>(null);

  // User A state
  const [realDraft, setRealDraft] = useState<DraftView | null>(null);
  const [realProgress, setRealProgress] = useState<Partial<StoredMachineProgress> | null>(null);

  const [signupCardOpen, setSignupCardOpen] = useState(false);
  const [signupComplete, setSignupComplete] = useState(false);

  const simulatedStatus =
    simulatedProgress?.adventureCompleted || simulatedProgress?.rookRescued
      ? ("completed" as const)
      : simulatedProgress?.keyRetrieved || simulatedDraft !== null
        ? ("in_progress" as const)
        : ("not_started" as const);

  const realStatus =
    realProgress?.adventureCompleted || realProgress?.rookRescued
      ? ("completed" as const)
      : realProgress?.keyRetrieved || realDraft !== null
        ? ("in_progress" as const)
        : ("not_started" as const);

  const simulatedOpp = generateSimulatedOpportunity("Northside Mechanical");

  const resetAll = useCallback(() => {
    setInAdventure(false);
    setSimulatedDraft(null);
    setSimulatedProgress(null);
    setRealDraft(null);
    setRealProgress(null);
    setSignupCardOpen(false);
    setSignupComplete(false);
  }, []);

  // Adapter for User B (Simulated opportunity)
  const simulatedAdapter: MachineBusinessAdapter = {
    isSimulated: true,
    example: false,
    businessName: "Northside Mechanical",
    opportunity: simulatedOpp,
    draft: simulatedDraft,
    activation: null,
    checkoutNotice: null,
    connectNotice: null,
    onPrepareDraft: async () => {
      const draft = createSimulatedDraft(simulatedOpp, "still_wanted");
      setSimulatedDraft(draft);
    },
    onChangeDraft: async change => {
      setSimulatedDraft(prev => {
        if (!prev) return prev;
        return change.approach
          ? createSimulatedDraft(simulatedOpp, change.approach)
          : { ...prev, body: change.body ?? prev.body, edited: true };
      });
    },
    onDeclineDraft: async () => {
      setSimulatedDraft(prev => (prev ? { ...prev, status: "declined" } : null));
    },
    onRecordChoice: async () => {},
    onRecordMilestone: async payload => {
      setSimulatedProgress(prev => ({
        ...prev,
        keyRetrieved: payload.milestone === "key_retrieved" ? true : prev?.keyRetrieved,
        centerExamined: payload.milestone === "center_examined" ? true : prev?.centerExamined,
        returnCompleted: payload.milestone === "return_completed" ? true : prev?.returnCompleted,
        returnRouteUsed: payload.route ?? prev?.returnRouteUsed,
        rookRescued: payload.milestone === "rook_rescued" ? true : prev?.rookRescued,
        adventureCompleted: payload.milestone === "adventure_completed" ? true : prev?.adventureCompleted,
      }));
    },
    onSendDraft: async () => {
      setSimulatedDraft(prev =>
        prev
          ? {
              ...prev,
              status: "verified_sent",
              verifiedSentAt: new Date().toISOString(),
              sentByJoystick: true,
            }
          : null
      );
      return "sent";
    },
    onFinishAdventure: async () => {
      setInAdventure(false);
    },
  };

  // Adapter for User A (Sample customer inquiry)
  const realAdapter: MachineBusinessAdapter = {
    isSimulated: false,
    example: false,
    businessName: "Wildroot Floral Studio",
    opportunity: SAMPLE_REAL_OPPORTUNITY,
    draft: realDraft,
    activation: {
      required: false,
      example: false,
      offer: null,
      status: signupComplete ? "active" : "none",
      owner: signupComplete ? "ready" : null,
      identity: { businessName: "Wildroot Floral Studio", contactName: "Nina", ownerEmail: "owner@wildroot.example" },
      sendFrom: "owner@wildroot.example",
      canSend: true,
      returnOrigin: "https://bldg-admin-api-production.up.railway.app",
    },
    checkoutNotice: null,
    connectNotice: null,
    onPrepareDraft: async () => {
      const draft = createSimulatedDraft(SAMPLE_REAL_OPPORTUNITY, "offer_start");
      setRealDraft(draft);
    },
    onChangeDraft: async change => {
      setRealDraft(prev => {
        if (!prev) return prev;
        return { ...prev, body: change.body ?? prev.body, edited: true };
      });
    },
    onDeclineDraft: async () => {
      setRealDraft(prev => (prev ? { ...prev, status: "declined" } : null));
    },
    onRecordChoice: async () => {},
    onRecordMilestone: async payload => {
      setRealProgress(prev => ({
        ...prev,
        keyRetrieved: payload.milestone === "key_retrieved" ? true : prev?.keyRetrieved,
        centerExamined: payload.milestone === "center_examined" ? true : prev?.centerExamined,
        returnCompleted: payload.milestone === "return_completed" ? true : prev?.returnCompleted,
        returnRouteUsed: payload.route ?? prev?.returnRouteUsed,
        rookRescued: payload.milestone === "rook_rescued" ? true : prev?.rookRescued,
        adventureCompleted: payload.milestone === "adventure_completed" ? true : prev?.adventureCompleted,
      }));
    },
    onSendDraft: async () => {
      setRealDraft(prev =>
        prev
          ? {
              ...prev,
              status: "verified_sent",
              verifiedSentAt: new Date().toISOString(),
              sentByJoystick: true,
            }
          : null
      );
      return "sent";
    },
    onFinishAdventure: async () => {
      setInAdventure(false);
    },
  };

  const currentAdapter = mode === "user_b" ? simulatedAdapter : realAdapter;
  const currentProgress = mode === "user_b" ? simulatedProgress : realProgress;
  const currentStatus = mode === "user_b" ? simulatedStatus : realStatus;

  return (
    <div style={{ minHeight: "100vh", background: "#17100b", color: "#fcf6eb", padding: "16px 12px 64px" }}>
      {/* Top Experience Switcher & Status Bar */}
      <header
        style={{
          maxWidth: "1220px",
          margin: "0 auto 20px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "12px 18px",
          background: "rgba(32, 23, 16, 0.95)",
          border: "1px solid rgba(213, 160, 69, 0.4)",
          borderRadius: "10px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span
            style={{
              padding: "4px 8px",
              background: "#d5a045",
              color: "#181008",
              fontWeight: 800,
              fontSize: "11px",
              letterSpacing: "0.12em",
              borderRadius: "4px",
            }}
          >
            JOYSTICK ONBOARDING
          </span>
          <span style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: "17px", fontWeight: 600 }}>
            The Impossible Machine · Live Playable Preview
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: "rgba(0,0,0,0.4)", padding: "3px", borderRadius: "8px", border: "1px solid rgba(213,160,69,0.3)" }}>
            <button
              type="button"
              onClick={() => {
                setMode("user_b");
                setInAdventure(false);
              }}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "none",
                background: mode === "user_b" ? "#d5a045" : "transparent",
                color: mode === "user_b" ? "#181008" : "#fdf6eb",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
              }}
              data-testid="preview-mode-user-b"
            >
              User B (No Opportunity)
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("user_a");
                setInAdventure(false);
              }}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "none",
                background: mode === "user_a" ? "#d5a045" : "transparent",
                color: mode === "user_a" ? "#181008" : "#fdf6eb",
                fontWeight: 700,
                fontSize: "12px",
                cursor: "pointer",
              }}
              data-testid="preview-mode-user-a"
            >
              User A (Sample Customer Inquiry)
            </button>
          </div>

          <button
            type="button"
            onClick={resetAll}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid rgba(213,160,69,0.3)",
              background: "rgba(255,255,255,0.06)",
              color: "#e6cfb3",
              fontSize: "12px",
              cursor: "pointer",
            }}
          >
            Reset State
          </button>
        </div>
      </header>

      {/* Main View Area */}
      <main style={{ maxWidth: "1220px", margin: "0 auto" }}>
        {!inAdventure ? (
          /* Kept Portrait & Chapter Threshold View */
          <div
            style={{
              maxWidth: "680px",
              margin: "24px auto",
              padding: "32px 24px",
              background: "#241a12",
              border: "2px solid #8c6123",
              borderRadius: "12px",
              boxShadow: "0 18px 40px rgba(0,0,0,0.7)",
            }}
          >
            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              <div
                style={{
                  display: "inline-block",
                  padding: "4px 10px",
                  borderRadius: "999px",
                  background: "rgba(213, 160, 69, 0.2)",
                  border: "1px solid #d5a045",
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  color: "#ffd97d",
                  marginBottom: "10px",
                }}
              >
                {mode === "user_b" ? "USER B EXPERIENCE · NO CORRESPONDENCE" : "USER A EXPERIENCE · SAMPLE CUSTOMER INQUIRY"}
              </div>
              <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: "28px", margin: "6px 0", color: "#fdf5e6" }}>
                {mode === "user_b" ? "Northside Mechanical" : "Wildroot Floral Studio"}
              </h1>
              <p style={{ color: "#cbb396", fontSize: "14px", margin: "0 0 6px" }}>
                Claire’s portrait of your business is kept.
              </p>
              {mode === "user_a" && (
                <p style={{ color: "#ffd97d", fontSize: "12px", margin: 0, fontStyle: "italic" }}>
                  Sample customer inquiry (Elena Ruiz) for gameplay preview · Not real connected customer data.
                </p>
              )}
            </div>

            {/* Threshold with Claire's Introduction & Simulated Machine Entry */}
            <ChapterThreshold
              gate="no_opportunity"
              retrying={false}
              onRetry={() => {}}
              onLookCloser={() => {}}
              onEnterSimulated={() => setInAdventure(true)}
              simulatedStatus={currentStatus}
              signup={
                <div
                  style={{
                    marginTop: "20px",
                    padding: "16px",
                    background: "rgba(15, 10, 6, 0.8)",
                    border: "1px solid rgba(213,160,69,0.35)",
                    borderRadius: "8px",
                  }}
                  data-testid="first-ten-signup"
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                    <div>
                      <h4 style={{ margin: "0 0 4px", fontSize: "14px", color: "#ffd97d" }}>
                        {signupComplete ? "JOYSTICK Activated · Workspace Ready" : "Keep your crew · Open JOYSTICK"}
                      </h4>
                      <p style={{ margin: 0, fontSize: "12px", color: "#cfbba6" }}>
                        {signupComplete
                          ? "Owner activation simulated. Access your workspace anytime."
                          : "Gameplay preview mode · No customer email required to activate."}
                      </p>
                    </div>
                    {!signupComplete ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSignupCardOpen(true);
                          setSignupComplete(true);
                        }}
                        style={{
                          padding: "8px 14px",
                          borderRadius: "6px",
                          background: "#d5a045",
                          color: "#181008",
                          fontWeight: 700,
                          fontSize: "12px",
                          border: "none",
                          cursor: "pointer",
                        }}
                        data-testid="first-ten-mock-checkout"
                      >
                        Simulate Activation
                      </button>
                    ) : (
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "#68d391" }}>✓ Activated</span>
                    )}
                  </div>
                </div>
              }
            />
          </div>
        ) : (
          /* Inside The Impossible Machine Adventure */
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
                padding: "8px 14px",
                background: "rgba(30, 20, 12, 0.85)",
                border: "1px solid rgba(213, 160, 69, 0.3)",
                borderRadius: "8px",
              }}
            >
              <span style={{ fontSize: "13px", color: "#f8ecd5" }}>
                Mode: <strong style={{ color: "#ffd97d" }}>{mode === "user_b" ? "User B (Three Days Later Scenario)" : "User A (Sample Customer Inquiry — Elena Ruiz)"}</strong>
              </span>
              <button
                type="button"
                onClick={() => setInAdventure(false)}
                style={{
                  padding: "5px 12px",
                  borderRadius: "6px",
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(213, 160, 69, 0.4)",
                  color: "#ffd97d",
                  fontSize: "12px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
                data-testid="first-ten-back-to-page"
              >
                ← Back to your page (Pause &amp; Exit)
              </button>
            </div>

            {/* The Assembled Impossible Machine */}
            <ImpossibleMachine
              adapter={currentAdapter}
              initialProgress={currentProgress}
            />

            {/* In-game Checkout Bypass Button */}
            <div style={{ textAlign: "center", marginTop: "16px" }}>
              <button
                type="button"
                onClick={() => {
                  setInAdventure(false);
                  setSignupCardOpen(true);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#d5a045",
                  textDecoration: "underline",
                  fontSize: "13px",
                  cursor: "pointer",
                  padding: "8px 16px",
                }}
                data-testid="first-ten-signup-bypass"
              >
                Continue with JOYSTICK (Bypass Adventure to Purchase)
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
