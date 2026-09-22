import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GOLDLINE_RELAY_UPGRADE_REJECTED } from "./conversationRelayUpgrade";
import {
  GOLDLINE_RELAY_UPGRADE_REJECTED as PROBE_MARKER,
  authenticatedProbePlan,
  classifyUpgradeProbe,
  parseUpgradeProbeResponse,
  publicProbeLine,
  upgradeProbeBodyLimit,
} from "../../../scripts/probeConversationRelayUpgrade.mjs";

const MARKER = "goldline-relay-upgrade-rejected";

describe("conversation relay upgrade probe", () => {
  it("uses the same fixed marker as the upgrade handler", () => {
    expect(PROBE_MARKER).toBe(GOLDLINE_RELAY_UPGRADE_REJECTED);
    expect(PROBE_MARKER).toBe(MARKER);
  });

  it("classifies a Goldline 403 as the upgrade path reaching the application", () => {
    const parsed = parseUpgradeProbeResponse(
      "HTTP/1.1 403 Forbidden\r\n" +
        "Content-Type: text/plain\r\n" +
        `X-Goldline-Relay-Upgrade: ${MARKER}\r\n` +
        `Content-Length: ${MARKER.length}\r\n` +
        "Connection: close\r\n\r\n" +
        MARKER
    );
    expect(parsed.markerHeader).toBe(MARKER);
    expect(parsed.bodySample).toBe(MARKER);
    expect(
      classifyUpgradeProbe({
        status: parsed.status,
        contentType: parsed.contentType,
        markerHeader: parsed.markerHeader,
        body: parsed.bodySample,
        authenticated: false,
      })
    ).toEqual({
      classification: "UPGRADE PATH REACHES APPLICATION",
      detail: "Goldline 403 marker",
    });
  });

  it("does not treat an edge 403, HTML 200, or edge 400 as the Goldline handler", () => {
    expect(
      classifyUpgradeProbe({
        status: 403,
        contentType: "text/plain",
        markerHeader: null,
        body: "Forbidden",
        authenticated: false,
      }).classification
    ).toBe("403 WITHOUT GOLDLINE MARKER");
    expect(
      classifyUpgradeProbe({
        status: 200,
        contentType: "text/html; charset=utf-8",
        markerHeader: null,
        body: "<!DOCTYPE html><html>",
        authenticated: false,
      })
    ).toEqual({
      classification: "REQUEST DID NOT HIT THE UPGRADE HANDLER",
      detail: "old code or proxy downgraded",
    });
    expect(
      classifyUpgradeProbe({
        status: 400,
        contentType: "text/plain",
        markerHeader: null,
        body: "Bad Request",
        authenticated: false,
      })
    ).toEqual({
      classification: "UPGRADE REJECTED BEFORE OUR HANDLER",
      detail: "edge-generated 400",
    });
  });

  it("counts 101 only for an explicit authenticated probe", () => {
    expect(
      classifyUpgradeProbe({
        status: 101,
        contentType: null,
        markerHeader: null,
        body: "",
        authenticated: false,
      }).classification
    ).toBe("UNEXPECTED ANONYMOUS 101");
    expect(
      classifyUpgradeProbe({
        status: 101,
        contentType: null,
        markerHeader: null,
        body: "",
        authenticated: true,
      }).classification
    ).toBe("AUTHENTICATED UPGRADE");
  });

  it("stays credential-free unless authenticated mode already has both values", () => {
    expect(authenticatedProbePlan({}).mode).toBe("anonymous");
    expect(authenticatedProbePlan({}).send).toBe(true);
    const missing = authenticatedProbePlan({ CLAIRE_RELAY_PROBE_MODE: "authenticated" });
    expect(missing.send).toBe(false);
    expect(missing.reason).toContain("CLAIRE_RELAY_PROBE_TOKEN");
    expect(missing.reason).not.toContain("secret-token");
    const ready = authenticatedProbePlan({
      CLAIRE_RELAY_PROBE_MODE: "authenticated",
      CLAIRE_RELAY_PROBE_TOKEN: "secret-token",
      CLAIRE_RELAY_PROBE_SIGNATURE: "secret-signature",
    });
    expect(ready.send).toBe(true);
    const printed = JSON.stringify(
      publicProbeLine({
        host: "admin.bldg.chat",
        mode: ready.mode,
        status: 101,
        marker: false,
        classification: "AUTHENTICATED UPGRADE",
        detail: "101 only in explicit authenticated probe mode",
        token: ready.token,
        signature: ready.signature,
        path: "/api/claire/twilio/conversation-relay?token=secret-token",
      })
    );
    expect(printed).not.toContain("secret-token");
    expect(printed).not.toContain("secret-signature");
    expect(printed).toContain("/api/claire/twilio/conversation-relay");
    expect(printed).not.toContain("?");
  });

  it("caps the body it keeps and does not prompt for secrets", () => {
    expect(upgradeProbeBodyLimit("HTTP/1.1 200 OK\r\nContent-Length: 9000\r\n", 200)).toBe(256);
    expect(upgradeProbeBodyLimit("HTTP/1.1 101 Switching Protocols\r\n", 101)).toBe(0);
    const html = `<!DOCTYPE html>${"x".repeat(400)}`;
    const sample = parseUpgradeProbeResponse(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n${html}`);
    expect(sample.bodySample.length).toBeLessThanOrEqual(256);
    const source = readFileSync(new URL("../../../scripts/probeConversationRelayUpgrade.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/readline|prompt\(/);
    expect(source).toContain("JSON.stringify(\n        publicProbeLine(");
    expect(source).not.toMatch(/console\.log\((?![\s\S]{0,40}JSON\.stringify\([\s\S]{0,40}publicProbeLine)/);
  });
});
