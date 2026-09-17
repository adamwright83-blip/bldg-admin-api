import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acknowledgeCampaignRunBeat,
  campaignRunPresentationStorageKey,
  loadCampaignRunPresentation,
  markCampaignRunFieldEntered,
} from "./campaignRunPresentationStorage";

describe("campaignRunPresentationStorage", () => {
  const store = new Map<string, string>();
  const fakeStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, value),
  };

  beforeEach(() => {
    store.clear();
    (globalThis as { window?: unknown }).window = { localStorage: fakeStorage };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("starts with no field entry and no acknowledged beat", () => {
    expect(loadCampaignRunPresentation("run-1")).toEqual({
      campaignRunId: "run-1",
      fieldEntered: false,
      acknowledgedBeatId: null,
    });
  });

  it("preserves field entry across a simulated reload without writing progress", () => {
    markCampaignRunFieldEntered("run-1");
    const reloaded = loadCampaignRunPresentation("run-1");
    expect(reloaded.fieldEntered).toBe(true);
    expect(JSON.stringify(reloaded)).not.toContain("qualified");
    expect(JSON.stringify(reloaded)).not.toContain("complete");
  });

  it("does not treat another run's field entry as this run's", () => {
    markCampaignRunFieldEntered("run-1");
    expect(loadCampaignRunPresentation("run-2").fieldEntered).toBe(false);
  });

  it("keeps a dismissed beat dismissed after reload, and drops extra business fields", () => {
    acknowledgeCampaignRunBeat("run-1", "bc_first_sector");
    fakeStorage.setItem(
      campaignRunPresentationStorageKey("run-1"),
      JSON.stringify({
        campaignRunId: "run-1",
        fieldEntered: true,
        acknowledgedBeatId: "bc_first_sector",
        qualified: 12,
        complete: true,
      })
    );
    const loaded = loadCampaignRunPresentation("run-1");
    expect(loaded.acknowledgedBeatId).toBe("bc_first_sector");
    expect(loaded.fieldEntered).toBe(true);
    expect(loaded).toEqual({
      campaignRunId: "run-1",
      fieldEntered: true,
      acknowledgedBeatId: "bc_first_sector",
    });
  });
});
