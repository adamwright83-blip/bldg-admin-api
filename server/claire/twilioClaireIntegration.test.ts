import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TWILIO_CAPABILITY_IDS, TWILIO_CAPABILITY_REASONS } from "@shared/twilioPlatform";
import { UNVERIFIED_TRANSCRIPT_EVIDENCE } from "@shared/twilioFuture";

const hoisted = vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "auth_test_token_value";
  process.env.CLAIRE_TWILIO_FROM_NUMBER = "+13105550000";
  process.env.CLAIRE_OPERATOR_PHONE = "+13105550001";
  process.env.TWILIO_FROM_NUMBER = "+13105550022";
  delete process.env.CLAIRE_TWILIO_CONVERSATION_RELAY;
  return {
    getUserByOpenId: vi.fn(async (openId: string) => ({
      tenantId: "goldline",
      openId,
    })),
  };
});

vi.mock("../_core/env", () => ({
  ENV: {
    adminBaseUrl: "https://api.example.test",
    cookieSecret: "test-secret",
    ownerOpenId: "adam-admin",
    xaiApiKey: "",
    claireXaiTtsEnabled: false,
    claireXaiTtsVoiceId: "eve",
  },
}));

vi.mock("../db", async importOriginal => ({
  ...(await importOriginal<typeof import("../db")>()),
  getUserByOpenId: (openId: string) => hoisted.getUserByOpenId(openId),
}));

import { s2sAgentToolAllowlist } from "../agents/s2sEndpoint";
import { assertToolPermission, type AgentContext } from "../agents/permissions";
import { getAgentTool } from "../agents/toolRegistry";
import { evaluateTwilioCapability, evaluateTwilioCapabilities } from "../twilioPlatform/capabilities";
import {
  buildTwilioCommunicationReceipt,
  createMemoryCommunicationReceiptStore,
  setCommunicationReceiptStoreForTests,
} from "../twilioPlatform/communicationReceipts";
import { authoritiesCreatedByTranscript } from "../twilioPlatform/future/transcriptCandidate";
import { preDriveConversationTwiML } from "./claireTwilio";
import {
  loadClaireCommunicationsContext,
  readClaireCommunicationsContext,
} from "./communicationsContextPort";
import { applyOperatorArtifactDecision } from "./operatorArtifactDecision";
import { renderClaireOpeningVoice } from "./voice/claireVoiceTransport";

const voiceEnv = {
  TWILIO_ACCOUNT_SID: "AC_test",
  TWILIO_AUTH_TOKEN: "auth_test",
  CLAIRE_TWILIO_FROM_NUMBER: "+13105550000",
  CLAIRE_OPERATOR_PHONE: "+13105550001",
} as NodeJS.ProcessEnv;

function operatorVoice(agentType: AgentContext["agentType"]): AgentContext {
  return {
    tenantId: "goldline",
    agentType,
    actorType: "voice",
    actorId: "adam-admin",
  };
}

beforeEach(() => {
  setCommunicationReceiptStoreForTests(createMemoryCommunicationReceiptStore());
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "auth_test_token_value";
  process.env.CLAIRE_TWILIO_FROM_NUMBER = "+13105550000";
  process.env.CLAIRE_OPERATOR_PHONE = "+13105550001";
  process.env.TWILIO_FROM_NUMBER = "+13105550022";
  delete process.env.CLAIRE_TWILIO_CONVERSATION_RELAY;
  hoisted.getUserByOpenId.mockReset();
  hoisted.getUserByOpenId.mockImplementation(async (openId: string) => ({
    tenantId: "goldline",
    openId,
  }));
});

afterEach(() => {
  setCommunicationReceiptStoreForTests(null);
  delete process.env.CLAIRE_TWILIO_CONVERSATION_RELAY;
});

describe("Claire Twilio integration seams", () => {
  it("holds an operator artifact without calling the SMS port", async () => {
    const port = { send: vi.fn() };
    const result = await applyOperatorArtifactDecision({ action: "hold" }, { port });
    expect(result).toEqual({ applied: false, action: "hold" });
    expect(port.send).not.toHaveBeenCalled();
  });

  it("sends only from an explicit decision and refuses a caller destination", async () => {
    const port = {
      send: vi.fn(async () => ({ messageSid: "SM_decision", status: "queued" })),
    };
    const sent = await applyOperatorArtifactDecision(
      {
        action: "send_operator_artifact",
        tenantId: "goldline",
        operatorUserId: "adam-admin",
        artifact: { kind: "plain_text", text: "Gate code is 1924" },
      },
      { port }
    );
    expect(sent.applied).toBe(true);
    if (sent.applied) {
      expect(sent.result.providerAccepted).toBe(true);
      expect(sent.result.delivered).toBe(false);
      expect(sent.result.resolvedTo).toBe("+13105550001");
      expect(sent.result.evidence.some(item => item.concept === "MESSAGE_SENT")).toBe(true);
    }
    expect(port.send).toHaveBeenCalledTimes(1);
    const create = port.send.mock.calls[0]?.[0] as { to: string; body: string };
    expect(create.to).toBe("+13105550001");
    expect(create.body).toContain("Gate code is 1924");

    await expect(
      applyOperatorArtifactDecision(
        {
          action: "send_operator_artifact",
          tenantId: "goldline",
          operatorUserId: "adam-admin",
          artifact: { kind: "plain_text", text: "Text Dana" },
          to: "+15551230000",
        } as never,
        { port }
      )
    ).rejects.toThrow(/cannot supply a phone number/);
  });

  it("exposes the send as an operator-voice tool and keeps it off resident S2S", () => {
    expect(getAgentTool("sendOperatorArtifactTool").name).toBe("sendOperatorArtifactTool");
    expect(() => assertToolPermission(operatorVoice("operator_voice_agent"), "sendOperatorArtifactTool")).not.toThrow();
    expect(() => assertToolPermission(operatorVoice("resident_agent"), "sendOperatorArtifactTool")).toThrow(
      /resident_agent is not allowed/
    );
    expect(s2sAgentToolAllowlist.has("sendOperatorArtifactTool")).toBe(false);
  });

  it("feeds call evidence into a read-only port that implies no business outcome", () => {
    const receipt = buildTwilioCommunicationReceipt(
      {
        tenantId: "goldline",
        operatorUserId: "adam-admin",
        eventType: "CALL_CONNECTED",
        callSid: "CA_connected",
        direction: "outbound",
        status: "in-progress",
        durationSeconds: 224,
      },
      voiceEnv
    );
    const port = readClaireCommunicationsContext({ receipts: [receipt] });
    expect(port.access).toBe("read_only");
    expect(port.impliesBusinessOutcome).toBe(false);
    expect(port.evidence.map(item => item.concept)).toEqual([
      "CALL_CONNECTED",
      "CALL_DURATION_OBSERVED",
    ]);
    expect(port.evidence.every(item => item.goldlineEntityId === null)).toBe(true);
    expect(Object.isFrozen(port)).toBe(true);
    expect("write" in port).toBe(false);
  });

  it("exposes transcript candidates as unverified input only", () => {
    const port = readClaireCommunicationsContext({
      transcriptCandidates: [
        {
          evidenceClass: "possible_commitment",
          text: "I'll close Louise tomorrow",
          sentiment: "positive",
        },
      ],
    });
    const candidate = port.transcriptCandidates[0];
    expect(candidate?.status).toBe(UNVERIFIED_TRANSCRIPT_EVIDENCE);
    expect(candidate?.regard).toBeNull();
    expect(authoritiesCreatedByTranscript(candidate!)).toEqual([]);
    expect(authoritiesCreatedByTranscript(candidate!)).not.toContain("DailyCommandPrimary");
    expect(authoritiesCreatedByTranscript(candidate!)).not.toContain("WeeklyIntent");
    expect(authoritiesCreatedByTranscript(candidate!)).not.toContain("NarratorEvent");
  });

  it("loads an empty read-only port when no receipt database is configured", async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    const port = await loadClaireCommunicationsContext({
      tenantId: "goldline",
      operatorUserId: "adam-admin",
      transcriptCandidates: [
        { evidenceClass: "possible_follow_up", text: "Call Dana Thursday" },
      ],
    });
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    expect(port.access).toBe("read_only");
    expect(port.evidence).toEqual([]);
    expect(port.transcriptCandidates[0]?.status).toBe(UNVERIFIED_TRANSCRIPT_EVIDENCE);
  });

  it("keeps Gather when Conversation Relay is off and does not mark Relay LIVE", () => {
    const input = {
      text: "Two stops today.",
      token: "signed-token",
      opening: true,
      hints: "Louise, Wilshire",
    };
    const gather = preDriveConversationTwiML(input);
    expect(
      renderClaireOpeningVoice({
        ...input,
        publicBaseUrl: "https://api.example.test",
        renderGather: preDriveConversationTwiML,
        env: voiceEnv,
      })
    ).toBe(gather);
    const flagged = evaluateTwilioCapability("conversationRelay", {
      ...voiceEnv,
      CLAIRE_TWILIO_CONVERSATION_RELAY: "true",
    });
    expect(flagged.state).toBe("CONFIGURED");
    expect(flagged.state).not.toBe("LIVE");
    const off = evaluateTwilioCapability("conversationRelay", voiceEnv);
    expect(off).toEqual({
      id: "conversationRelay",
      state: "DISABLED",
      reason: TWILIO_CAPABILITY_REASONS.featureFlagOff,
    });
  });

  it("leaves Lookup, Verify, Proxy, Conference, TaskRouter, and Sync short of LIVE", () => {
    const records = evaluateTwilioCapabilities(voiceEnv);
    for (const id of ["lookup", "verify", "proxy", "conference", "taskRouter", "sync"] as const) {
      const record = records.find(item => item.id === id);
      expect(record?.state).not.toBe("LIVE");
      expect(record?.state === "UNCONFIGURED" || record?.state === "DISABLED").toBe(true);
    }
    expect(records.map(item => item.id)).toEqual([...TWILIO_CAPABILITY_IDS]);
  });

  it("selects opening voice through the relay seam and writes lifecycle receipts on existing callbacks", () => {
    const source = readFileSync(new URL("./claireTwilio.ts", import.meta.url), "utf8");
    expect(source).toContain("const interactiveTwiml = openingVoiceTwiml(");
    expect(source).toContain("twiml: openingVoiceTwiml(");
    expect(source).toContain("CLAIRE_INBOUND_VOICE_PATH");
    expect(source.match(/writeClaireLifecycleReceipt\(body\)/g)).toHaveLength(2);
    expect(source).toContain('export const CLAIRE_INBOUND_VOICE_PATH = "/api/claire/twilio/inbound"');
    expect(source).toContain('export const CLAIRE_CALL_STATUS_PATH = "/api/claire/twilio/call-status"');
    expect(source).toContain('export const CLAIRE_RECORDING_STATUS_PATH = "/api/claire/twilio/recording-status"');
    const seam = readFileSync(new URL("./operatorArtifactDecision.ts", import.meta.url), "utf8");
    expect(seam).not.toContain("calls.create");
    expect(seam).not.toContain("setInterval");
  });
});
