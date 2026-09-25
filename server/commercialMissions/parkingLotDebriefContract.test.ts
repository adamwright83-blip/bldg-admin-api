import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../drizzle/0097_driver_sales_journal_debrief_mission.sql", import.meta.url),
  "utf8"
);
const schema = readFileSync(
  new URL("../../drizzle/schema.ts", import.meta.url),
  "utf8"
);
const service = readFileSync(
  new URL("./driverSalesMotivationService.ts", import.meta.url),
  "utf8"
);
const controller = readFileSync(
  new URL("../../client/src/pages/driver/GoldlineDriverController.tsx", import.meta.url),
  "utf8"
);
const journal = readFileSync(
  new URL("../../client/src/components/driver/SalesMomentum.tsx", import.meta.url),
  "utf8"
);

describe("parking-lot debrief contract", () => {
  it("stores a durable mission link on the raw journal", () => {
    expect(migration).toContain("debriefMissionId");
    expect(migration).toContain("idx_driver_sales_journal_tenant_mission");
    expect(schema).toContain('debriefMissionId: int("debriefMissionId")');
    expect(service).toContain("debriefMissionId: input.debriefMissionId ?? null");
  });

  it("accepts a mission-linked debrief only after this operator recorded that visit", () => {
    expect(service).toContain("eq(commercialVisitOutcomes.missionId, input.debriefMissionId)");
    expect(service).toContain("eq(commercialVisitOutcomes.recordedBy, input.driverId)");
    expect(service).toContain("The debrief requires your recorded field visit.");
  });

  it("opens immediately after the authoritative visit result persists", () => {
    const outcomeIndex = controller.indexOf("recordVisitOutcome.mutateAsync");
    const debriefIndex = controller.indexOf("setDebrief({", outcomeIndex);
    const openIndex = controller.indexOf("setJournalOpen(true);", debriefIndex);
    expect(outcomeIndex).toBeGreaterThan(-1);
    expect(debriefIndex).toBeGreaterThan(outcomeIndex);
    expect(openIndex).toBeGreaterThan(debriefIndex);
  });

  it("asks one concrete Claire question and labels the answer as reported memory", () => {
    expect(journal).toContain("CLAIRE · PARKING-LOT DEBRIEF");
    expect(journal).toContain("What did they actually say?");
    expect(journal).toContain("operator-reported memory");
    expect(journal).toContain("they are not independently verified");
    expect(journal).toContain("Save what they said");
  });

  it("keeps the world event truth class attested rather than verified", () => {
    expect(service).toContain('eventType: "field_journal_saved"');
    expect(service).toContain('provenanceClass: "operator_reported"');
    expect(service).toContain('verificationClass: "ATTESTED"');
    expect(service).toContain("debriefMissionId: input.debriefMissionId ?? null");
  });
});
