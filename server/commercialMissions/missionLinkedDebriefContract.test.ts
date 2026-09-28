import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const journal = readFileSync(
  new URL("./driverSalesMotivationService.ts", import.meta.url),
  "utf8"
);
const service = readFileSync(
  new URL("./missionLinkedDebriefService.ts", import.meta.url),
  "utf8"
);
const controller = readFileSync(
  new URL("../../client/src/pages/driver/GoldlineDriverController.tsx", import.meta.url),
  "utf8"
);
const actionSurface = readFileSync(
  new URL("../../client/src/game/actions/GoldlineActionSurface.tsx", import.meta.url),
  "utf8"
);
const journalSheet = readFileSync(
  new URL("../../client/src/components/driver/SalesMomentum.tsx", import.meta.url),
  "utf8"
);

describe("approved tower-boss linked debrief contract", () => {
  it("binds the known mission into the debrief instead of asking for the property again", () => {
    expect(controller).toContain("setDebrief(input)");
    expect(controller).toContain("setJournalOpen(true)");
    expect(actionSurface).toContain("props.action.missionId!");
    expect(actionSurface).toContain("buildingName: props.mission.name");
    expect(actionSurface).toContain("is already locked to this mission");
    expect(journalSheet).toContain("debrief?: { missionId: number; buildingName: string }");
    expect(journalSheet).toContain("debriefMissionId: debrief?.missionId");
  });

  it("allows raw debrief capture after persisted arrival rather than requiring a pre-existing outcome", () => {
    expect(journal).toContain("commercialMissionFieldStates.arrivedAt");
    expect(journal).toContain("The debrief requires a persisted field arrival.");
    expect(journal).not.toContain("The debrief requires your recorded field visit.");
  });

  it("persists audio before any asynchronous transcription/extraction is queued", () => {
    const storage = journal.indexOf("await storagePut(audioStorageKey");
    const durableRow = journal.indexOf("await db.insert(driverSalesJournals)");
    const processing = journal.indexOf("queueFieldJournalProcessing({");
    expect(storage).toBeGreaterThan(-1);
    expect(durableRow).toBeGreaterThan(storage);
    expect(processing).toBeGreaterThan(durableRow);
  });

  it("starts MediaRecorder before optional browser SpeechRecognition and survives its failure", () => {
    const start = journalSheet.indexOf("recorder.start(500)");
    const optionalTranscript = journalSheet.indexOf(
      "speechRef.current = startOptionalBrowserTranscript"
    );
    expect(start).toBeGreaterThan(-1);
    expect(optionalTranscript).toBeGreaterThan(start);
    expect(journalSheet).toContain("catch {\n    return null;");
    expect(journalSheet).toContain(
      "Recording is live. Chrome's live transcript is unavailable"
    );
  });

  it("uses one contextual missing-fact input instead of exposing the legacy visit form in production", () => {
    expect(actionSurface).toContain("missionDebrief.proposal.question ?");
    expect(actionSurface).toContain('data-testid="mission-debrief-answer"');
    expect(actionSurface).toContain("props.services.openMissionDebrief &&");
    expect(actionSurface).toContain("props.services.finalizeMissionDebrief");
    expect(actionSurface).toContain("!\n        props.services.openMissionDebrief");
  });

  it("persists requested collateral email as draft-only and contains no transport send path", () => {
    expect(service).toContain('eventName: "mission_debrief_email_draft"');
    expect(service).toContain('draftStatus: "draft"');
    expect(service).toContain("sendAuthorized: false");
    expect(service).not.toMatch(/agentmail|sendMail|sendEmail|smtp|gmail/i);
  });

  it("does not announce visit completion until the authoritative finalize mutation resolves", () => {
    const begin = actionSurface.indexOf("async function finalizeLinkedDebrief()");
    const end = actionSurface.indexOf("async function write(", begin);
    const block = actionSurface.slice(begin, end);
    const persist = block.indexOf("const next = await finalize({");
    const refresh = block.indexOf("await refresh()");
    const success = block.indexOf("props.onPersisted()");
    expect(persist).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(persist);
    expect(success).toBeGreaterThan(refresh);
  });

  it("does not celebrate raw debrief capture as if the tower was won", () => {
    expect(journalSheet).toContain("if (!debrief) celebrate(result.worldEvent)");
    expect(journalSheet).toContain(
      "Raw debrief secured. Claire is decoding the encounter."
    );
  });
});
