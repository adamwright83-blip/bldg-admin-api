/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { describe, expect, it } from "vitest";
import {
  getCleanCloudCredentials,
  isCleanCloudDirectConfigured,
} from "./cleancloudDirectSync";
import { isDirectSyncDue } from "./cleancloudDirectScheduler";

describe("cleancloud direct sync credentials & configuration", () => {
  it("detects when direct sync credentials are missing", () => {
    const creds = getCleanCloudCredentials({
      baseUrl: "https://cleancloudapp.com/store",
      username: "",
      password: "",
    });
    expect(creds).toBeNull();
    expect(
      isCleanCloudDirectConfigured({
        baseUrl: "https://cleancloudapp.com/store",
        username: "",
        password: "",
      })
    ).toBe(false);
  });

  it("extracts valid direct sync credentials when present", () => {
    const creds = getCleanCloudCredentials({
      baseUrl: "https://cleancloudapp.com/store",
      username: "operator@example.com",
      password: "secretpassword123",
    });
    expect(creds).toEqual({
      baseUrl: "https://cleancloudapp.com/store",
      username: "operator@example.com",
      password: "secretpassword123",
    });
    expect(
      isCleanCloudDirectConfigured({
        username: "operator@example.com",
        password: "secretpassword123",
      })
    ).toBe(true);
  });
});

describe("cleancloud direct sync scheduler timing", () => {
  it("marks sync due when there has never been a successful sync", async () => {
    const due = await isDirectSyncDue(null, new Date("2026-09-29T18:05:00.000Z"));
    expect(due).toBe(true);
  });

  it("marks sync due when last sync was more than 20 hours ago", async () => {
    const now = new Date("2026-09-29T19:00:00.000Z");
    const last = new Date(now.getTime() - 21 * 3600 * 1000);
    const due = await isDirectSyncDue(last, now);
    expect(due).toBe(true);
  });

  it("marks sync due after 6 PM Pacific when last success was from a prior day", async () => {
    // 6:05 PM Pacific on 2026-09-29 is 2026-09-30T01:05:00.000Z (PDT is UTC-7)
    const now = new Date("2026-09-30T01:05:00.000Z");
    // Last sync was 10:00 AM Pacific on 2026-09-28 (yesterday)
    const last = new Date("2026-09-28T17:00:00.000Z");
    const due = await isDirectSyncDue(last, now);
    expect(due).toBe(true);
  });

  it("does not trigger redundant sync if already synced today within 20 hours", async () => {
    // 6:15 PM Pacific on 2026-09-29 is 2026-09-30T01:15:00.000Z
    const now = new Date("2026-09-30T01:15:00.000Z");
    // Last sync was 6:02 PM Pacific on 2026-09-29 (13 minutes ago today)
    const last = new Date("2026-09-30T01:02:00.000Z");
    const due = await isDirectSyncDue(last, now);
    expect(due).toBe(false);
  });

  it("does not trigger before 6 PM Pacific if last sync was 5 hours ago", async () => {
    // 2:00 PM Pacific on 2026-09-29 is 2026-09-29T21:00:00.000Z
    const now = new Date("2026-09-29T21:00:00.000Z");
    // Last sync was 9:00 AM Pacific on 2026-09-29 (5 hours ago)
    const last = new Date("2026-09-29T16:00:00.000Z");
    const due = await isDirectSyncDue(last, now);
    expect(due).toBe(false);
  });
});
