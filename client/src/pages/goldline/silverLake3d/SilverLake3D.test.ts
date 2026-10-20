import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const outreach = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("./useSilverLakeOutreach", () => ({ useSilverLakeOutreach: () => outreach.value }));
vi.mock("./silverLakeRuntime", () => ({ createSilverLake: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/components/admin/control-room/LanternCitySceneV6/PlayableLetterDesk", () => ({ PlayableLetterDesk: () => null }));
vi.mock("@/components/admin/control-room/LanternCitySceneV6/CozyMessageComposer", () => ({ CozyMessageComposer: () => null }));
vi.mock("@/components/admin/control-room/LanternCitySceneV6/NeighborhoodCourtyardFeature", () => ({ NeighborhoodCourtyardFeature: () => null }));
import SilverLake3D from "./SilverLake3D";

const base = {
  tenantId: "laundry_farm",
  requestedId: null,
  showDevControls: false,
  experienceMode: "playable",
  setExperienceMode: () => {},
  isSyntheticPreview: false,
  setIsSyntheticPreview: () => {},
  targets: [],
  loading: false,
  loadFailed: false,
  withheldReason: null,
  emptyMeansNoLapsed: false,
  objectiveId: null,
  isSending: false,
  neighborhoodMemory: { featureChoice: null, encounterCounts: {}, lastDraftedCustomer: null },
  memoryNote: null,
  selectedSlotId: null,
  setSelectedSlotId: () => {},
  selectedTarget: null,
  selectedIndex: -1,
  handleSelectIndex: () => {},
  handleSendNow: async () => {},
  handleScheduleSend: async () => {},
  handleChooseCourtyardFeature: async () => {},
  handleDraftCompleted: async () => {},
  handleSaveUnfinishedDraft: async () => {},
};

const render = () => renderToStaticMarkup(createElement(SilverLake3D, { onExit: () => {} }));

describe("Silver Lake 3D neighbours roster tells the truth", () => {
  beforeEach(() => {
    outreach.value = { ...base };
  });

  it("shows the server's withheld reason, never 'no one to reconnect with'", () => {
    outreach.value = { ...base, withheldReason: "The recovery objective could not be read. Missing customers are not proof that nobody is inactive." };
    const html = render();
    expect(html).toContain('data-outreach-withheld="true"');
    expect(html).toContain("The recovery objective could not be read.");
    expect(html).not.toContain("No one to reconnect with");
  });

  it("only says there is no one to reconnect with when the server says the list is truly empty", () => {
    outreach.value = { ...base, emptyMeansNoLapsed: true };
    expect(render()).toContain("No one to reconnect with here today.");
    outreach.value = { ...base, emptyMeansNoLapsed: false };
    const html = render();
    expect(html).not.toContain("No one to reconnect with");
    expect(html).toContain("No neighbours are listed here right now.");
  });

  it("a failed read says nothing was sent and claims nothing about who is inactive", () => {
    outreach.value = { ...base, loadFailed: true };
    const html = render();
    expect(html).toContain("could not load right now. Nothing has been sent.");
    expect(html).not.toContain("No one to reconnect with");
  });
});
