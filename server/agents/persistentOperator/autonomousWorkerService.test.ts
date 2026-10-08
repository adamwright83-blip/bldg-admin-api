/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { describe, expect, it, vi } from "vitest";
import { startAutonomousPersistentOperatorWorkers } from "./autonomousWorkerService";

describe("AutonomousPersistentOperatorWorkers", () => {
  it("disables cleanly when explicit enabled option is false", async () => {
    const stop = startAutonomousPersistentOperatorWorkers({ enabled: false });
    expect(typeof stop).toBe("function");
    await expect(stop()).resolves.toBeUndefined();
  });

  it("disables cleanly when AUTONOMOUS_WORKERS_ENABLED is 0", async () => {
    const original = process.env.AUTONOMOUS_WORKERS_ENABLED;
    process.env.AUTONOMOUS_WORKERS_ENABLED = "0";
    try {
      const stop = startAutonomousPersistentOperatorWorkers();
      expect(typeof stop).toBe("function");
      await expect(stop()).resolves.toBeUndefined();
    } finally {
      if (original !== undefined) {
        process.env.AUTONOMOUS_WORKERS_ENABLED = original;
      } else {
        delete process.env.AUTONOMOUS_WORKERS_ENABLED;
      }
    }
  });

  it("handles absent DATABASE_URL gracefully without throwing", async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const stop = startAutonomousPersistentOperatorWorkers();
      expect(typeof stop).toBe("function");
      await expect(stop()).resolves.toBeUndefined();
    } finally {
      if (original !== undefined) {
        process.env.DATABASE_URL = original;
      }
    }
  });
});
