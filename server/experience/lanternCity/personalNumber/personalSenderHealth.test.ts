import { describe, expect, it, beforeEach } from "vitest";
import { evaluateGoogleMessagesBrowserTransport } from "./googleMessagesBrowserTransport";
import { classifyPersonalSenderHealth } from "./personalSenderHealth";
import {
  _resetPersonalSenderIdentityStore,
  getPersonalSenderStatus,
  recordPersonalSenderObservation,
} from "./personalSenderIdentityStore";
import { ANDROID_DEVICE_SENDER } from "./androidDeviceSender";
import { assertGumballNotGoogleMessages } from "../../../integrations/cleancloud/browserSync/gumballSessionBoundary";

const now = new Date("2026-10-15T18:00:00.000Z");

function healthyObservation(overrides: Record<string, unknown> = {}) {
  return {
    pairingPresent: true,
    displacesExistingWebSession: false,
    pageLoaded: true,
    deviceOnline: true,
    sessionObservedAt: now,
    now,
    originatingPhone: "+12135550100",
    originatingPhoneVerified: true,
    observationSource: "android_telephony_line" as const,
    deviceId: "pixel-operator",
    expectedDeviceId: "pixel-operator",
    transportProbeOk: true,
    ...overrides,
  };
}

describe("personal sender health", () => {
  beforeEach(() => {
    _resetPersonalSenderIdentityStore();
  });

  it("treats a missing session as Requires Pairing", () => {
    const result = classifyPersonalSenderHealth(
      healthyObservation({ pairingPresent: false, pageLoaded: true, transportProbeOk: false })
    );
    expect(result.stateLabel).toBe("Requires Pairing");
    expect(result.authorizedToTransmit).toBe(false);
  });

  it("blocks a browser session that would displace the operator's Google Messages web session", () => {
    const result = classifyPersonalSenderHealth(
      healthyObservation({ displacesExistingWebSession: true })
    );
    expect(result.state).toBe("requires_pairing");
    expect(result.blockReason).toMatch(/BLOCKED/);
    expect(result.blockReason).toMatch(/not signed out/);
    expect(result.authorizedToTransmit).toBe(false);
  });

  it("does not treat a Google account, CleanCloud contact, business phone, or page load as the sender", () => {
    for (const observationSource of [
      "google_account",
      "cleancloud_contact",
      "business_twilio",
      "page_load",
      "unknown",
    ] as const) {
      const result = classifyPersonalSenderHealth(healthyObservation({ observationSource }));
      expect(result.stateLabel).toBe("Identity Unverified");
      expect(result.authorizedToTransmit).toBe(false);
    }
  });

  it("does not treat an unverified or malformed originating number as authorized", () => {
    expect(
      classifyPersonalSenderHealth(healthyObservation({ originatingPhoneVerified: false })).state
    ).toBe("identity_unverified");
    expect(
      classifyPersonalSenderHealth(healthyObservation({ originatingPhone: "5551234567" })).state
    ).toBe("identity_unverified");
  });

  it("treats a stale session as Disconnected", () => {
    const result = classifyPersonalSenderHealth(
      healthyObservation({
        sessionObservedAt: new Date(now.getTime() - 5 * 60_000),
      })
    );
    expect(result.stateLabel).toBe("Disconnected");
    expect(result.sessionStale).toBe(true);
    expect(result.authorizedToTransmit).toBe(false);
  });

  it("treats an offline handset as Disconnected", () => {
    const result = classifyPersonalSenderHealth(healthyObservation({ deviceOnline: false }));
    expect(result.stateLabel).toBe("Disconnected");
  });

  it("treats page load without a transport probe as Unhealthy", () => {
    const result = classifyPersonalSenderHealth(
      healthyObservation({ pageLoaded: true, transportProbeOk: false })
    );
    expect(result.stateLabel).toBe("Unhealthy");
    expect(result.blockReason).toMatch(/Page load is not a health check/);
  });

  it("treats the wrong handset as Unhealthy", () => {
    const result = classifyPersonalSenderHealth(
      healthyObservation({ deviceId: "other-phone" })
    );
    expect(result.state).toBe("unhealthy");
  });

  it("can classify a fresh verified handset as Connected without authorizing a send", () => {
    const result = classifyPersonalSenderHealth(healthyObservation());
    expect(result.stateLabel).toBe("Connected");
    expect(result.authorizedToTransmit).toBe(false);
    expect(result.blockReason).toMatch(/not authorization to transmit/);
  });

  it("keeps the Google Messages browser transport blocked", () => {
    const browser = evaluateGoogleMessagesBrowserTransport();
    expect(browser.status).toBe("BLOCKED");
    expect(browser.attempted).toBe(false);
    expect(browser.carrierDeliveryObserved).toBe(false);
    expect(browser.reason).toMatch(/DOM click is not proof of send/);
    expect(browser.reason).toMatch(/not signed out/);
  });

  it("keeps the Android handset path blocked on the human gate", () => {
    expect(ANDROID_DEVICE_SENDER.status).toBe("BLOCKED");
    expect(ANDROID_DEVICE_SENDER.reason).toMatch(/Silence is not approval/);
    expect(ANDROID_DEVICE_SENDER.reason).toMatch(/No customer may receive a message/);
  });

  it("refuses to attach Gumball to Google Messages", () => {
    expect(() => assertGumballNotGoogleMessages("https://messages.google.com/web/conversations")).toThrow(
      /BLOCKED: Gumball must not attach to Google Messages/
    );
    expect(() => assertGumballNotGoogleMessages("https://cleancloudapp.com/store")).not.toThrow();
  });

  it("reports Requires Pairing when the operator has no identity record", async () => {
    const status = await getPersonalSenderStatus({
      tenantId: "tenant_health",
      operatorId: "op_health",
      now,
    });
    expect(status.stateLabel).toBe("Requires Pairing");
    expect(status.authorizedToTransmit).toBe(false);
    expect(status.originatingPhone).toBeNull();
    expect(status.browserTransport.status).toBe("BLOCKED");
    expect(status.deviceTransport.status).toBe("BLOCKED");
    expect(status.humanGates.livePairing.status).toBe("BLOCKED");
    expect(status.humanGates.controlledSelfSend.status).toBe("BLOCKED");
    expect(status.carrierDeliveryObserved).toBe(false);
  });

  it("reclassifies a stored fresh session as stale on a later read", async () => {
    await recordPersonalSenderObservation({
      tenantId: "tenant_health",
      operatorId: "op_health",
      pairingPresent: true,
      displacesExistingWebSession: false,
      pageLoaded: true,
      deviceOnline: true,
      sessionObservedAt: now,
      originatingPhone: "+12135550100",
      originatingPhoneVerified: true,
      observationSource: "android_telephony_line",
      deviceId: "pixel-operator",
      expectedDeviceId: "pixel-operator",
      transportProbeOk: true,
      now,
    });
    const later = await getPersonalSenderStatus({
      tenantId: "tenant_health",
      operatorId: "op_health",
      now: new Date(now.getTime() + 5 * 60_000),
    });
    expect(later.stateLabel).toBe("Disconnected");
    expect(later.sessionStale).toBe(true);
    expect(later.authorizedToTransmit).toBe(false);
  });

  it("hides an originating number that came from a forbidden source", async () => {
    const status = await recordPersonalSenderObservation({
      tenantId: "tenant_health",
      operatorId: "op_health",
      pairingPresent: true,
      displacesExistingWebSession: false,
      pageLoaded: true,
      deviceOnline: true,
      sessionObservedAt: now,
      originatingPhone: "+12135550100",
      originatingPhoneVerified: true,
      observationSource: "business_twilio",
      deviceId: "pixel-operator",
      expectedDeviceId: "pixel-operator",
      transportProbeOk: true,
      now,
    });
    expect(status.stateLabel).toBe("Identity Unverified");
    expect(status.originatingPhone).toBeNull();
  });
});
