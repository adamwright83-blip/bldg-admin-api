import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { installAuthoritativeActionResume } from "./useAuthoritativeActionResume";

const services = readFileSync(
  new URL("./actionServices.ts", import.meta.url),
  "utf8"
);
const resume = readFileSync(
  new URL("./useAuthoritativeActionResume.ts", import.meta.url),
  "utf8"
);

describe("authoritative action services", () => {
  it("uses explicit action-specific service contracts instead of a generic payload", () => {
    for (const name of [
      "recordCall",
      "startVisitPreparation",
      "departVisit",
      "arriveVisit",
      "recordVisitOutcome",
      "completeFollowUp",
      "rescheduleFollowUp",
      "recover",
      "scout",
    ])
      expect(services).toContain(name);
    expect(services).not.toContain("payload: unknown");
    expect(services).not.toContain("saveOutcome");
  });

  it("resume listeners only refetch and collapse duplicate Android events", () => {
    expect(resume).toContain('addEventListener("visibilitychange"');
    expect(resume).toContain('addEventListener("pageshow"');
    expect(resume).toContain('addEventListener("focus"');
    expect(resume).not.toContain(".mutate");
    expect(resume).not.toContain("onPersist");
  });

  it("deduplicates an Android resume burst and removes every listener", async () => {
    const documentTarget = new EventTarget();
    const windowTarget = new EventTarget();
    const onResume = vi.fn(async () => undefined);
    const controller = installAuthoritativeActionResume({
      documentTarget,
      windowTarget,
      isVisible: () => true,
      onResume,
    });

    controller.arm();
    windowTarget.dispatchEvent(new Event("blur"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    windowTarget.dispatchEvent(new Event("pageshow"));
    windowTarget.dispatchEvent(new Event("focus"));
    await Promise.resolve();
    expect(onResume).toHaveBeenCalledTimes(1);

    controller.arm();
    controller.dispose();
    windowTarget.dispatchEvent(new Event("focus"));
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});
