import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  new URL("./commercialMissionFieldService.ts", import.meta.url),
  "utf8"
);
const router = readFileSync(
  new URL("./commercialMissionRouter.ts", import.meta.url),
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

describe("parking-lot Clerk contract", () => {
  it("reuses the commercial mission event stream instead of creating another visit identity", () => {
    expect(service).toContain("commercialMissionEvents");
    expect(service).toContain("PARKING_LOT_CLERK_EVENT_NAME");
    expect(service).toContain("missionId: input.missionId");
    expect(service).toContain("PARKING_LOT_CLERK_PROVENANCE");
    expect(service).not.toContain("parking_lot_clerk_id");
    expect(service).not.toContain("clerkMissionId");
  });

  it("accepts testimony only after persisted arrival and visit outcome", () => {
    expect(service).toContain("fieldRows[0]?.arrivedAt");
    expect(service).toContain("Parking-lot Clerk requires the persisted real visit arrival.");
    expect(service).toContain("Parking-lot Clerk requires the persisted real visit outcome.");
    expect(service).toContain("outcome.recordedBy !== input.actorId");
  });

  it("derives the prompt from durable field state instead of opening a generic journal after mutation", () => {
    expect(actionSurface).toContain("context?.visitOutcome && !context.parkingLotClerkObservation");
    expect(actionSurface).toContain("WHAT DID THEY ACTUALLY SAY?");
    expect(actionSurface).toContain("recordParkingLotClerkObservation");
    const outcomeIndex = controller.indexOf("recordVisitOutcome.mutateAsync");
    const nextFunction = controller.indexOf("async function recordParkingLotClerkAction", outcomeIndex);
    const intervening = controller.slice(outcomeIndex, nextFunction);
    expect(outcomeIndex).toBeGreaterThan(-1);
    expect(intervening).not.toContain("setJournalOpen(true)");
  });

  it("exposes one typed read and one field write using signed-session ownership", () => {
    expect(router).toContain("parkingLotClerkObservation:");
    expect(router).toContain("fieldParkingLotClerk:");
    expect(router).toContain("getParkingLotClerkObservation");
    expect(router).toContain("actorId: ctx.user.openId");
    expect(router).not.toContain("actorId: input.actorId");
  });

  it("keeps testimony operator-reported and does not manufacture business outcomes", () => {
    expect(service).toContain('provenance: PARKING_LOT_CLERK_PROVENANCE');
    expect(service).not.toContain('eventName: "account_won"');
    expect(actionSurface).toContain("operator-reported");
    expect(actionSurface).toContain("does not create a sale, booking, approval");
  });
});
